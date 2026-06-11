import fs from 'fs/promises';
import path from 'path';
import { DeveloperAgent } from './agents/developer.js';
import { TesterAgent } from './agents/tester.js';
import { ReviewerAgent } from './agents/reviewer.js';
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

  constructor(config: OrchestratorConfig) {
    this.config = config;

    const agentConfig: AgentConfig = {
      ...config,
      name: 'orchestrator',
    };

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

    await this.runPipeline(0);
  }

  private async runPipeline(retryCount: number): Promise<void> {
    this.log(`Pipeline run (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    this.log('Developer: generating code...');
    await this.developer.run('requirements.md', 'src/index.ts');
    this.log('Developer: done');

    this.log('Tester: generating tests...');
    await this.tester.run('src/index.ts', 'tests/index.test.ts');
    this.log('Tester: done');

    this.log('Reviewer: reviewing code...');
    const review = await this.reviewer.run('src/index.ts', 'reviews/review.md');
    this.log('Reviewer: done');

    if (review.includes('需修改') && retryCount < MAX_RETRIES) {
      this.log(`Review requires changes, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await this.runPipeline(retryCount + 1);
    } else if (review.includes('需修改')) {
      this.log('Max retries reached. Pipeline completed with unresolved issues.');
    } else {
      this.log('Pipeline completed successfully');
    }
  }

  private log(message: string): void {
    console.log(`[Orchestrator] ${message}`);
  }
}
