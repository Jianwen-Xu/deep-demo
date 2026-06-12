import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { execFile } from 'child_process';
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

const MAX_RETRIES = 3;

export class Orchestrator {
  private config: OrchestratorConfig;
  private developer: DeveloperAgent;
  private tester: TesterAgent;
  private reviewer: ReviewerAgent;
  private llm: LLMClient;
  private logger = new Logger();

  constructor(config: OrchestratorConfig) {
    this.config = config;

    const agentConfig: AgentConfig = {
      ...config,
      name: 'orchestrator',
    };

    this.llm = new LLMClient(config);
    this.developer = new DeveloperAgent({ ...agentConfig, name: 'developer' });
    this.tester = new TesterAgent({ ...agentConfig, name: 'tester' });
    this.reviewer = new ReviewerAgent({ ...agentConfig, name: 'reviewer' });
  }

  async init(): Promise<void> {
    const dirs = ['tasks', 'src', 'tests', 'reviews'];
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

  private async decomposeTasks(): Promise<void> {
    this.logger.start('Orchestrator', 'Analyzing and decomposing tasks');
    const requirements = await fs.readFile(
      path.join(this.config.workspace, 'requirements.md'),
      'utf-8'
    );

    const prompt = `你是一个项目管理专家。分析以下需求，将其拆分为可执行的开发任务。

需求：
${requirements}

输出格式（每个任务一行）：
任务1: [任务描述]
任务2: [任务描述]
...

要求：
- 每个任务应该是独立的、可测试的功能点
- 任务之间有明确的依赖关系
- 保持简洁，3-5个任务为宜`;

    const result = await this.llm.chat(prompt, '请分析并拆分任务。');
    const tasksContent = `# 任务分解

${result.text}

# 原始需求
${requirements}`;

    await fs.writeFile(
      path.join(this.config.workspace, 'tasks', '00-task-decomposition.md'),
      tasksContent,
      'utf-8'
    );
    this.logger.end('Orchestrator', 'Analyzing and decomposing tasks');
  }

  private async runPipeline(): Promise<void> {
    let reviewFeedback = '';

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      this.logger.log('Orchestrator', `Pipeline run (attempt ${attempt}/${MAX_RETRIES + 1})`);

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
        this.logger.start('Developer', 'Fixing code from review feedback');
      } else {
        this.logger.start('Developer', 'Generating code');
      }
      await this.developer.run(devInput, 'src/index.ts');
      this.logger.end('Developer', devInput === 'requirements.md' ? 'Generating code' : 'Fixing code from review feedback');

      this.logger.start('Tester', 'Generating tests');
      await this.tester.run('src/index.ts', 'tests/index.test.ts');
      this.logger.end('Tester', 'Generating tests');

      this.logger.start('Orchestrator', 'Running tests');
      const testResult = await this.runChecks('test');
      if (!testResult.passed) {
        this.logger.log('Orchestrator', `Tests failed: ${testResult.output}`);
        reviewFeedback = this.buildFailureFeedback('测试未通过', testResult.output);
        continue;
      }
      this.logger.end('Orchestrator', 'Running tests');

      this.logger.start('Orchestrator', 'Running type check');
      const typeResult = await this.runChecks('typecheck');
      if (!typeResult.passed) {
        this.logger.log('Orchestrator', `Type check failed: ${typeResult.output}`);
        reviewFeedback = this.buildFailureFeedback('类型检查未通过', typeResult.output);
        continue;
      }
      this.logger.end('Orchestrator', 'Running type check');

      this.logger.start('Reviewer', 'Reviewing code');
      await this.reviewer.run('src/index.ts', 'reviews/review.md');
      this.logger.end('Reviewer', 'Reviewing code');

      const review = await fs.readFile(
        path.join(this.config.workspace, 'reviews', 'review.md'),
        'utf-8'
      );

      if (review.includes('## 结论') && review.includes('通过')) {
        this.logger.log('Orchestrator', 'Pipeline completed successfully');
        return;
      }
      reviewFeedback = review;
      this.logger.log('Orchestrator', `Review requires changes, retrying (${attempt}/${MAX_RETRIES})...`);
    }
    this.logger.log('Orchestrator', 'Max retries reached. Pipeline completed with unresolved issues.');
    process.exitCode = 1;
  }

  private async runChecks(type: 'test' | 'typecheck'): Promise<{ passed: boolean; output: string }> {
    const projectRoot = this.resolveProjectRoot();
    if (!projectRoot) {
      this.logger.log('Orchestrator', `Skipping ${type}: no package.json found in workspace tree`);
      return { passed: true, output: '' };
    }

    try {
      if (type === 'test') {
        await execFileAsync('npx', ['vitest', 'run', 'workspace/tests/index.test.ts', '--reporter', 'verbose'], {
          cwd: projectRoot,
          timeout: 60000,
        });
      } else {
        await execFileAsync('npx', ['tsc', '--noEmit', '--project', path.join(this.config.workspace, 'tsconfig.json')], {
          cwd: projectRoot,
          timeout: 60000,
        });
      }
      return { passed: true, output: '' };
    } catch (err: any) {
      return {
        passed: false,
        output: err.stderr || err.stdout || err.message || '',
      };
    }
  }

  private resolveProjectRoot(): string | null {
    let dir = path.resolve(this.config.workspace);
    for (let i = 0; i < 10; i++) {
      if (fsSync.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  }

  private buildFailureFeedback(title: string, detail: string): string {
    return `## Review 摘要
${title}

## 问题列表
- [严重] ${title}

## 建议
- 请根据以下错误信息修复代码：

\`\`\`
${detail.slice(0, 2000)}
\`\`\`

## 结论
需修改 ${title}`;
  }
}
