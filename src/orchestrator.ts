import fs from 'fs/promises';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { DeveloperAgent } from './agents/developer.js';
import { TesterAgent } from './agents/tester.js';
import { ReviewerAgent } from './agents/reviewer.js';
import { LLMClient } from './llm.js';
import { Logger } from './logger.js';
import { StageTracker, STAGE_LABELS } from './stage.js';
import type { RunState } from './stage.js';
import {
  oneLine,
  parseReport,
  readReport,
  reportPath,
  reportToFeedback,
  writeBlockedNote,
} from './report.js';
import type { ParsedReport, Report } from './report.js';
import type { AgentConfig } from './types.js';

const execFileAsync = promisify(execFile);

export interface OrchestratorConfig {
  workspace: string;
  apiKey: string;
  baseURL: string;
  model: string;
  verbose?: boolean;
}

/** 流水线终局：完成 / 需要人 / 失败 */
export type PipelineOutcome = 'done' | 'blocked' | 'failed';

interface AgentRunner {
  run(inputPath: string, outputPath: string): Promise<string>;
}

interface Diagnosis {
  action: 'retry_dev' | 'retry_tester' | 'blocked';
  reason: string;
  feedback: string;
  question?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_ATTEMPTS = 4;
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_TIMEOUT_MS = 15_000;
const DEV_SERVER_MAX_LIFETIME_MS = 5 * 60 * 1_000;

export class Orchestrator {
  private config: OrchestratorConfig;
  private developer: DeveloperAgent;
  private tester: TesterAgent;
  private reviewer: ReviewerAgent;
  private diagnosticClient: LLMClient;
  private logger = new Logger();
  private devServer: ChildProcess | null = null;
  private devServerTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupRegistered = false;
  private tracker = new StageTracker(MAX_ATTEMPTS);

  constructor(config: OrchestratorConfig) {
    this.config = config;

    const agentConfig: AgentConfig = {
      ...config,
      name: 'orchestrator',
    };

    this.diagnosticClient = new LLMClient(config);
    this.developer = new DeveloperAgent({ ...agentConfig, name: 'developer' });
    this.tester = new TesterAgent({ ...agentConfig, name: 'tester' });
    this.reviewer = new ReviewerAgent({ ...agentConfig, name: 'reviewer' });
  }

  private get verbose(): boolean {
    return this.config.verbose || false;
  }

  /** 当前运行状态（第二阶段会把它持久化，供重启后恢复） */
  getState(): Readonly<RunState> {
    return this.tracker.current;
  }

  async init(): Promise<void> {
    const dirs = ['tasks', 'reviews', 'tests', 'reports'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.config.workspace, dir), { recursive: true });
    }
    this.logger.log('Orchestrator', 'Workspace directories created');
  }

  async run(requirementsPath: string): Promise<PipelineOutcome> {
    this.tracker = new StageTracker(MAX_ATTEMPTS);
    const workspace = this.config.workspace;
    const destPath = path.join(workspace, 'requirements.md');
    await fs.copyFile(requirementsPath, destPath);
    this.logger.log('Orchestrator', 'Requirements copied to workspace');

    await this.decomposeTasks();
    return this.runPipeline();
  }

  private cleanup(): void {
    this.stopDevServer();
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const handler = async () => {
      this.cleanup();
      process.exitCode = 0;
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    process.on('exit', () => this.stopDevServer());
  }

  private async decomposeTasks(): Promise<void> {
    this.logger.log('Orchestrator', 'Task decomposition integrated into Developer prompt');
    const requirements = await fs.readFile(
      path.join(this.config.workspace, 'requirements.md'),
      'utf-8'
    ).catch(() => '');
    await fs.writeFile(
      path.join(this.config.workspace, 'tasks', '00-task-decomposition.md'),
      `# 任务分解（由 Developer Agent 自动处理）\n\n${requirements}`,
      'utf-8'
    );
  }

  private transition(to: RunState['stage'], reason?: string): void {
    const change = this.tracker.transition(to, reason);
    if (!change) return;
    this.logger.log(
      'Orchestrator',
      `阶段: ${change.from ? STAGE_LABELS[change.from] : '(新建)'} → ${STAGE_LABELS[change.to]}` +
        (change.reason ? ` · ${change.reason}` : '')
    );
  }

  /**
   * 跑一个 Agent 并拿到它的结构化汇报。
   * 先清掉上一轮的汇报文件，避免旧结论污染新决策。
   */
  private async runAgentStage(
    agent: AgentRunner,
    inputPath: string,
    outputPath: string,
    name: string
  ): Promise<{ text: string; parsed: ParsedReport | null }> {
    const reportFile = path.join(this.config.workspace, reportPath(name));
    await fs.rm(reportFile, { force: true });

    const text = await agent.run(inputPath, outputPath);

    const fromFile = await readReport(reportFile);
    const parsed = fromFile ?? parseReport(text);

    if (!parsed) {
      this.logger.log(name, '未产出可解析的汇报，按 failed 处理');
      return { text, parsed: null };
    }

    if (parsed.warning) {
      this.logger.log(name, `汇报警告: ${parsed.warning}`);
    }
    this.logger.log(name, `汇报(${parsed.source}): ${oneLine(parsed.report)}`);
    return { text, parsed };
  }

  private missingReport(name: string): Report {
    return {
      status: 'failed',
      summary: `${name} 没有产出符合契约的 JSON 汇报`,
      issues: [],
      feedback: `${name} 未按汇报契约写入 ${reportPath(name)}，请严格按契约输出 JSON。`,
      artifacts: [],
    };
  }

  private async block(report: Report, source: string): Promise<'blocked'> {
    this.stopDevServer();
    const file = await writeBlockedNote(this.config.workspace, source, report);
    this.transition('blocked', `${source}: ${report.question ?? report.summary}`);

    this.logger.log('Orchestrator', '────────────────────────────────');
    this.logger.log('Orchestrator', `⏸  需要人工介入（${source}）`);
    this.logger.log('Orchestrator', `    ${report.question ?? report.summary}`);
    this.logger.log('Orchestrator', `    详情: ${file}`);
    this.logger.log('Orchestrator', '────────────────────────────────');
    return 'blocked';
  }

  private async runPipeline(): Promise<PipelineOutcome> {
    this.registerCleanup();
    let reviewFeedback = '';
    let skipDev = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.tracker.setAttempt(attempt);
      this.transition('working', `第 ${attempt}/${MAX_ATTEMPTS} 轮`);
      this.logger.log('Orchestrator', `Pipeline run (attempt ${attempt}/${MAX_ATTEMPTS})`);

      this.stopDevServer();
      await sleep(300);

      // ── Developer ────────────────────────────────────────────────
      // 本轮是否只重跑测试（上一轮诊断判定为测试问题）；要在重置 skipDev 之前捕获
      const retryTesterOnly = skipDev;
      if (!skipDev) {
        let devInput = 'requirements.md';
        if (reviewFeedback) {
          const requirements = await fs.readFile(
            path.join(this.config.workspace, 'requirements.md'),
            'utf-8'
          ).catch(() => '');
          const feedbackContent = `# 原始需求\n\n${requirements}\n\n# 反馈\n\n${reviewFeedback}`;
          const feedbackPath = path.join(this.config.workspace, 'tasks', 'review-feedback.md');
          await fs.writeFile(feedbackPath, feedbackContent, 'utf-8');
          devInput = 'tasks/review-feedback.md';
        }

        const action = devInput === 'requirements.md'
          ? 'Building prototype'
          : 'Fixing prototype from review feedback';
        this.logger.start('Developer', action);
        const dev = await this.runAgentStage(this.developer, devInput, 'package.json', 'developer');
        this.logger.end('Developer', action);

        const devReport = dev.parsed?.report;
        if (devReport?.status === 'blocked') return this.block(devReport, 'Developer');
        if (devReport && devReport.status !== 'ready') {
          reviewFeedback = reportToFeedback(devReport);
          continue;
        }
        if (!devReport) {
          reviewFeedback = reportToFeedback(this.missingReport('Developer'));
          continue;
        }
      }
      skipDev = false;

      // ── 构建 / 依赖 / 预览服务 ──────────────────────────────────
      const pkgJsonPath = path.join(this.config.workspace, 'package.json');
      try {
        await fs.access(pkgJsonPath);
      } catch {
        this.logger.log('Orchestrator', 'package.json not found, retrying...');
        reviewFeedback = this.buildFailureFeedback(
          '缺少 package.json',
          'Developer 没有生成 package.json，无法安装依赖和启动项目'
        );
        continue;
      }

      this.logger.start('Orchestrator', 'Installing dependencies');
      const installResult = await this.runCommand('npm', ['install'], this.config.workspace, 120_000);
      if (!installResult.passed) {
        this.logger.log('Orchestrator', `npm install failed: ${installResult.output}`);
        reviewFeedback = this.buildFailureFeedback('依赖安装失败', installResult.output);
        continue;
      }
      this.logger.end('Orchestrator', 'Installing dependencies');

      this.logger.start('Orchestrator', 'Installing Playwright browsers');
      await this.runCommand('npx', ['playwright', 'install', 'chromium'], this.config.workspace, 120_000);
      this.logger.end('Orchestrator', 'Installing Playwright browsers');

      this.logger.start('Orchestrator', 'Starting dev server');
      const devUrl = await this.startDevServer();
      if (!devUrl) {
        this.logger.log('Orchestrator', 'Dev server failed to start');
        reviewFeedback = this.buildFailureFeedback('Dev server 启动失败', '无法启动开发服务器');
        continue;
      }
      this.logger.log('Orchestrator', `Preview URL: ${devUrl}`);
      this.logger.end('Orchestrator', 'Starting dev server');

      // ── Tester ───────────────────────────────────────────────────
      await this.cleanOldTests();
      // retry_tester 时 Developer 被跳过，诊断反馈必须交给 Tester，否则反馈丢失
      this.tester.setDiagnosticFeedback(retryTesterOnly ? reviewFeedback : '');
      this.logger.start('Tester', 'Generating e2e tests');
      const tester = await this.runAgentStage(this.tester, '.', 'tests', 'tester');
      this.logger.end('Tester', 'Generating e2e tests');

      const testerReport = tester.parsed?.report;
      if (testerReport?.status === 'blocked') return this.block(testerReport, 'Tester');
      if (!testerReport || testerReport.status === 'failed') {
        reviewFeedback = reportToFeedback(testerReport ?? this.missingReport('Tester'));
        continue;
      }

      // ── 测试 ─────────────────────────────────────────────────────
      this.logger.start('Orchestrator', 'Running e2e tests');
      const testResult = await this.runPlaywrightTests();
      if (!testResult.passed) {
        this.logger.log('Orchestrator', `Tests failed: ${testResult.output}`);
        const diag = await this.diagnoseTestFailure(testResult.output);

        if (diag.action === 'blocked') {
          return this.block(
            {
              status: 'blocked',
              summary: diag.reason,
              question: diag.question ?? diag.reason,
              issues: [],
              artifacts: [],
            },
            'Orchestrator'
          );
        }

        skipDev = diag.action === 'retry_tester';
        reviewFeedback = diag.feedback;
        continue;
      }
      this.logger.end('Orchestrator', 'Running e2e tests');

      // ── Reviewer ─────────────────────────────────────────────────
      this.logger.start('Reviewer', 'Reviewing prototype');
      const review = await this.runAgentStage(this.reviewer, '.', 'reviews/review.md', 'reviewer');
      this.logger.end('Reviewer', 'Reviewing prototype');

      const reviewReport = review.parsed?.report;

      if (reviewReport?.status === 'blocked') return this.block(reviewReport, 'Reviewer');

      if (!reviewReport) {
        const markdown = await fs
          .readFile(path.join(this.config.workspace, 'reviews', 'review.md'), 'utf-8')
          .catch(() => review.text);
        reviewFeedback = markdown || reportToFeedback(this.missingReport('Reviewer'));
        this.logger.log('Orchestrator', 'Review requires changes, retrying...');
        continue;
      }

      if (reviewReport.status === 'ready') {
        this.logger.log('Orchestrator', 'Pipeline completed successfully');
        this.logger.log('Orchestrator', `原型预览地址: ${devUrl}`);
        this.logger.log(
          'Orchestrator',
          `开发服务器将在 ${DEV_SERVER_MAX_LIFETIME_MS / 1000} 秒后自动停止`
        );
        this.transition('done', `Reviewer: ${reviewReport.summary}`);

        this.devServerTimer = setTimeout(() => {
          this.logger.log('Orchestrator', 'Dev server auto-stopped after timeout');
          this.stopDevServer();
        }, DEV_SERVER_MAX_LIFETIME_MS);

        return 'done';
      }

      reviewFeedback = reportToFeedback(reviewReport);
      this.logger.log(
        'Orchestrator',
        `Review requires changes, retrying (${attempt}/${MAX_ATTEMPTS})...`
      );
    }

    this.transition('failed', '达到最大重试次数仍有未解决的问题');
    this.logger.log('Orchestrator', 'Max attempts reached. Pipeline completed with unresolved issues.');
    this.stopDevServer();
    return 'failed';
  }

  private async cleanOldTests(): Promise<void> {
    const testsDir = path.join(this.config.workspace, 'tests');
    try {
      const files = await fs.readdir(testsDir);
      for (const file of files) {
        if (file.endsWith('.spec.ts') || file.endsWith('.spec.js')) {
          await fs.rm(path.join(testsDir, file), { force: true });
        }
      }
    } catch {
      // tests dir may not exist yet, that's fine
    }
  }

  private async startDevServer(): Promise<string | null> {
    return new Promise((resolve) => {
      const cwd = this.config.workspace;
      const viteBin = path.resolve(cwd, 'node_modules', '.bin', 'vite');
      const child = spawn(viteBin, ['--port', String(DEV_SERVER_PORT)], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.devServer = child;

      const urlPattern = /Local:\s+(https?:\/\/[^\s]+)/;
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.logger.log('Orchestrator', 'Dev server start timeout, assuming default URL');
          resolve(`http://localhost:${DEV_SERVER_PORT}`);
        }
      }, DEV_SERVER_TIMEOUT_MS);

      const onData = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(urlPattern);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });

      child.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });
  }

  private stopDevServer(): void {
    if (this.devServerTimer) {
      clearTimeout(this.devServerTimer);
      this.devServerTimer = null;
    }
    if (this.devServer) {
      try {
        this.devServer.kill('SIGTERM');
      } catch { }
      this.devServer = null;
    }
  }

  private async runPlaywrightTests(): Promise<{ passed: boolean; output: string }> {
    try {
      const result = await execFileAsync('npx', ['playwright', 'test', '--reporter', 'list'], {
        cwd: this.config.workspace,
        timeout: 60_000,
      });
      return { passed: true, output: result.stdout };
    } catch (err: any) {
      return {
        passed: false,
        output: err.stderr || err.stdout || err.message || '',
      };
    }
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout: number
  ): Promise<{ passed: boolean; output: string }> {
    try {
      const result = await execFileAsync(command, args, { cwd, timeout });
      return { passed: true, output: result.stdout };
    } catch (err: any) {
      return {
        passed: false,
        output: err.stderr || err.stdout || err.message || '',
      };
    }
  }

  private async diagnoseTestFailure(errorOutput: string): Promise<Diagnosis> {
    const fileTree = await this.ls(this.config.workspace);
    const prompt = `你是 Deep-Demo 的总指挥。端到端测试失败。

错误信息：
${errorOutput.slice(0, 2000)}

当前工作目录文件：
${fileTree}

请判断是 Developer 的代码问题、Tester 的测试问题，还是必须由人介入。

常见测试问题（action=retry_tester）：
- 测试硬编码了错误的数量/值（如元素计数、文本内容）
- 测试选择器与 UI 实际结构不匹配（如 .element-cell 计数错误、选择器匹配到多个元素）
- 测试期望 CSS class 属性为 inline style（如 grid-template-columns 应检查 class 而非 style 属性）
- 测试 hover 交互时检查了错误的元素（如 hover 触发后读到其他元素的卡牌内容）
- 测试预期值与实际渲染不一致

action=blocked 只在需求本身矛盾、缺少只有人能提供的验收标准或凭据时使用；普通测试失败不要用 blocked。

只输出原始 JSON，不要 markdown 包裹，不要其他内容。
{"action": "retry_dev | retry_tester | blocked", "reason": "诊断理由（中文，简洁）", "feedback": "给 Developer 的具体修复指导（中文，简洁）", "question": "action=blocked 时向人提出的一个问题"}`;

    this.logger.start('Orchestrator', 'Diagnosing test failure');
    const result = await this.diagnosticClient.chat(prompt, 'Diagnose test failure', undefined, {
      agentName: 'Orchestrator',
      verbose: this.verbose,
    });
    this.logger.end('Orchestrator', 'Diagnosing test failure');

    const fallback: Diagnosis = {
      action: 'retry_dev',
      reason: '未能解析诊断结果',
      feedback: result.text,
    };

    try {
      const cleaned = result.text.replace(/```(json)?\n?/g, '').trim();
      const json = JSON.parse(cleaned) as Record<string, unknown>;
      const action =
        json.action === 'retry_tester' ? 'retry_tester'
          : json.action === 'blocked' || json.action === 'abort' ? 'blocked'
            : 'retry_dev';

      return {
        action,
        reason: typeof json.reason === 'string' ? json.reason : '测试失败',
        feedback: typeof json.feedback === 'string' ? json.feedback : result.text,
        question: typeof json.question === 'string' ? json.question : undefined,
      };
    } catch {
      return fallback;
    }
  }

  private buildFailureFeedback(title: string, detail: string): string {
    return `## Review 摘要
${title}

## 问题列表
- [严重] ${title}

## 建议
- 请根据以下错误信息修复：

\`\`\`
${detail.slice(0, 2000)}
\`\`\`

## 结论
需修改 ${title}`;
  }

  private async ls(dir: string, prefix = ''): Promise<string> {
    let result = '';
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      result += `${prefix}${entry.name}\n`;
      if (entry.isDirectory()) {
        result += await this.ls(path.join(dir, entry.name), prefix + '  ');
      }
    }
    return result;
  }
}
