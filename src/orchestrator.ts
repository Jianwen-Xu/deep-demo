import fs from 'fs/promises';
import path from 'path';
import { DeveloperAgent } from './agents/developer.js';
import { TesterAgent } from './agents/tester.js';
import { ReviewerAgent } from './agents/reviewer.js';
import { LLMClient } from './llm.js';
import type { AgentConfig } from './types.js';

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
    this.log('Workspace directories created');
  }

  async run(requirementsPath: string): Promise<void> {
    const workspace = this.config.workspace;
    const destPath = path.join(workspace, 'requirements.md');
    await fs.copyFile(requirementsPath, destPath);
    this.log('Requirements copied to workspace');

    await this.decomposeTasks();
    await this.runPipeline(0, '');
  }

  private async decomposeTasks(): Promise<void> {
    this.log('Analyzing requirements and decomposing tasks...');
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
    this.log('Task decomposition written to tasks/');
  }

  private async runPipeline(retryCount: number, reviewFeedback: string): Promise<void> {
    this.log(`Pipeline run (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    let devInput = 'requirements.md';
    if (reviewFeedback) {
      const feedbackPath = path.join(this.config.workspace, 'tasks', 'review-feedback.md');
      await fs.writeFile(feedbackPath, reviewFeedback, 'utf-8');
      devInput = 'tasks/review-feedback.md';
      this.log(`Developer: reviewing feedback and fixing code...`);
    } else {
      this.log('Developer: generating code...');
    }
    await this.developer.run(devInput, 'src/index.ts');
    this.log('Developer: done');

    this.log('Tester: generating tests...');
    await this.tester.run('src/index.ts', 'tests/index.test.ts');
    this.log('Tester: done');

    this.log('Reviewer: reviewing code...');
    const review = await this.reviewer.run('src/index.ts', 'reviews/review.md');
    this.log('Reviewer: done');

    if (review.includes('## 结论\n通过')) {
      this.log('Pipeline completed successfully');
    } else if (retryCount < MAX_RETRIES) {
      this.log(`Review requires changes, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await this.runPipeline(retryCount + 1, review);
    } else {
      this.log('Max retries reached. Pipeline completed with unresolved issues.');
    }
  }

  private log(message: string): void {
    console.log(`[Orchestrator] ${message}`);
  }
}
