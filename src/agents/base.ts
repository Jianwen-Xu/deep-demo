import { LLMClient } from '../llm.js';
import { createFileTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';

function extractCodeBlocks(text: string): string {
  const trimmed = text.trim();

  const matches = [...trimmed.matchAll(/```(\w+)?\n?([\s\S]*?)```/g)];
  if (matches.length > 0) {
    const lang = matches[0][1] || '';
    const isLikelyCode = lang === 'typescript' || lang === 'ts' || lang === 'javascript' || lang === 'js';
    const code = matches[matches.length - 1][2].trim();
    if (code) return code;
  }

  return '';
}

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

  abstract getSystemPrompt(inputPath: string, outputPath: string): string;

  protected async getInputMessage(inputPath: string): Promise<string> {
    return `请使用 readFile 工具读取 "${inputPath}" 了解内容，然后完成任务。`;
  }

  async run(inputPath: string, outputPath: string): Promise<string> {
    const { text, toolCalls } = await this.llm.chat(
      this.getSystemPrompt(inputPath, outputPath),
      await this.getInputMessage(inputPath),
      this.tools
    );

    const outputFull = path.join(this.workspace, outputPath);

    let exists = false;
    try {
      await fs.access(outputFull);
      exists = true;
    } catch { }

    if (!exists) {
      await fs.mkdir(path.dirname(outputFull), { recursive: true });
      const content = extractCodeBlocks(text);
      if (content) {
        await fs.writeFile(outputFull, content, 'utf-8');
      }
    }

    return text;
  }
}
