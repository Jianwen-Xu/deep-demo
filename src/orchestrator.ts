import fs from 'fs/promises';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { DeveloperAgent } from './agents/developer.js';
import { TesterAgent } from './agents/tester.js';
import { ReviewerAgent } from './agents/reviewer.js';
import { LLMClient } from './llm.js';
import { Logger } from './logger.js';
import type { AgentConfig } from './types.js';

const execFileAsync = promisify(execFile);

export interface OrchestratorConfig {
  workspace: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_RETRIES = 3;
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

  async init(): Promise<void> {
    const dirs = ['tasks', 'reviews', 'tests'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.config.workspace, dir), { recursive: true });
    }
    this.logger.log('Orchestrator', 'Workspace directories created');
  }

  async run(requirementsPath: string): Promise<void> {
    const workspace = this.config.workspace;
    const destPath = path.join(workspace, 'requirements.md');
    await fs.copyFile(requirementsPath, destPath);
    this.logger.log('Orchestrator', 'Requirements copied to workspace');

    await this.decomposeTasks();
    await this.runPipeline();
  }

  private async cleanup(): Promise<void> {
    this.stopDevServer();
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const handler = async () => {
      await this.cleanup();
      process.exit();
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

  private async runPipeline(): Promise<void> {
    this.registerCleanup();
    let reviewFeedback = '';
    let skipDev = false;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      this.logger.log('Orchestrator', `Pipeline run (attempt ${attempt}/${MAX_RETRIES + 1})`);

      this.stopDevServer();
      await sleep(300);

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
          this.logger.start('Developer', 'Fixing prototype from review feedback');
        } else {
          this.logger.start('Developer', 'Building prototype');
        }
        await this.developer.run(devInput, 'package.json');
        this.logger.end('Developer', devInput === 'requirements.md' ? 'Building prototype' : 'Fixing prototype from review feedback');
      }
      skipDev = false;

      const pkgJsonPath = path.join(this.config.workspace, 'package.json');
      try {
        await fs.access(pkgJsonPath);
      } catch {
        this.logger.log('Orchestrator', 'package.json not found, retrying...');
        reviewFeedback = this.buildFailureFeedback('缺少 package.json', 'Developer 没有生成 package.json，无法安装依赖和启动项目');
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

      this.logger.start('Orchestrator', 'Starting dev server');
      const devUrl = await this.startDevServer();
      if (!devUrl) {
        this.logger.log('Orchestrator', 'Dev server failed to start');
        reviewFeedback = this.buildFailureFeedback('Dev server 启动失败', '无法启动开发服务器');
        continue;
      }
      this.logger.log('Orchestrator', `Preview URL: ${devUrl}`);
      this.logger.end('Orchestrator', 'Starting dev server');

      this.logger.start('Tester', 'Generating e2e tests');
      await this.tester.run('.', 'tests');
      this.logger.end('Tester', 'Generating e2e tests');

      this.logger.start('Orchestrator', 'Running e2e tests');
      const testResult = await this.runPlaywrightTests();
      if (!testResult.passed) {
        this.logger.log('Orchestrator', `Tests failed: ${testResult.output}`);
        const diag = await this.diagnoseTestFailure(testResult.output);
        if (diag.action === 'abort') break;
        skipDev = diag.action === 'retry_tester';
        reviewFeedback = diag.feedback;
        continue;
      }
      this.logger.end('Orchestrator', 'Running e2e tests');

      this.logger.start('Reviewer', 'Reviewing prototype');
      await this.reviewer.run('.', 'reviews/review.md');
      this.logger.end('Reviewer', 'Reviewing prototype');

      const review = await fs.readFile(
        path.join(this.config.workspace, 'reviews', 'review.md'),
        'utf-8'
      );

      if (review.includes('## 结论') && review.includes('通过')) {
        this.logger.log('Orchestrator', 'Pipeline completed successfully');
        this.logger.log('Orchestrator', `原型预览地址: ${devUrl}`);
        this.logger.log('Orchestrator', `开发服务器将在 ${DEV_SERVER_MAX_LIFETIME_MS / 1000} 秒后自动停止`);

        this.devServerTimer = setTimeout(() => {
          this.logger.log('Orchestrator', 'Dev server auto-stopped after timeout');
          this.stopDevServer();
        }, DEV_SERVER_MAX_LIFETIME_MS);

        return;
      }

      reviewFeedback = review;
      this.logger.log('Orchestrator', `Review requires changes, retrying (${attempt}/${MAX_RETRIES})...`);
    }

    this.logger.log('Orchestrator', 'Max retries reached. Pipeline completed with unresolved issues.');
    process.exitCode = 1;
    this.stopDevServer();
  }

  private async startDevServer(): Promise<string | null> {
    return new Promise((resolve) => {
      const cwd = this.config.workspace;
      const child = spawn('npx', ['vite', '--port', String(DEV_SERVER_PORT)], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
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

  private async diagnoseTestFailure(
    errorOutput: string
  ): Promise<{ action: string; feedback: string }> {
    const fileTree = await this.ls(this.config.workspace);
    const prompt = `你是 Deep-Demo 的总指挥。端到端测试失败。

错误信息：
${errorOutput.slice(0, 2000)}

当前工作目录文件：
${fileTree}

请判断是 Developer 的代码问题还是 Tester 的测试问题。常见测试问题（action=retry_tester）：
- 测试硬编码了错误的数量/值（如元素计数、文本内容）
- 测试选择器与 UI 实际结构不匹配（如 .element-cell 计数错误、选择器匹配到多个元素）
- 测试期望 CSS class 属性为 inline style（如 grid-template-columns 应检查 class 而非 style 属性）
- 测试 hover 交互时检查了错误的元素（如 hover 触发后读到其他元素的卡牌内容）
- 测试预期值与实际渲染不一致
如果属于上述情况，action 应为 retry_tester。

只输出原始 JSON，不要 markdown 包裹，不要其他内容。
{"reason": "诊断理由（中文，简洁）", "action": "retry_dev", "feedback": "给 Developer 的具体修复指导（中文，简洁）"}`;

    this.logger.start('Orchestrator', 'Diagnosing test failure');
    const result = await this.diagnosticClient.chat(prompt, 'Diagnose test failure');
    this.logger.end('Orchestrator', 'Diagnosing test failure');

    try {
      const cleaned = result.text.replace(/```(json)?\n?/g, '').trim();
      const json = JSON.parse(cleaned);
      if (json.action === 'abort' || json.action === 'retry_tester') {
        return { action: json.action, feedback: json.feedback || result.text };
      }
      return { action: 'retry_dev', feedback: json.feedback || result.text };
    } catch {
      return { action: 'retry_dev', feedback: result.text };
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
