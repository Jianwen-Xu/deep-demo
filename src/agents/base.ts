import { LLMClient } from '../llm.js';
import { createFileTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';

export abstract class Agent {
  protected llm: LLMClient;
  protected workspace: string;
  protected name: string;
  protected tools: Record<string, any>;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.workspace = config.workspace;
    this.llm = new LLMClient(config);
    this.tools = createFileTools(config.workspace);
  }

  abstract getSystemPrompt(): string;

  async run(inputPath: string, outputPath: string): Promise<string> {
    const input = await fs.readFile(path.join(this.workspace, inputPath), 'utf-8');

    const output = await this.llm.chat(
      this.getSystemPrompt(),
      input,
      this.tools
    );

    const outputFull = path.join(this.workspace, outputPath);
    await fs.mkdir(path.dirname(outputFull), { recursive: true });
    await fs.writeFile(outputFull, output, 'utf-8');

    return output;
  }
}
