import { LLMClient } from '../llm.js';
import { createFileTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import type { ToolSet } from '../tools.js';
import type { ChatOptions } from '../llm.js';
import fs from 'fs/promises';
import path from 'path';

function extractCodeBlocks(text: string): string {
  const trimmed = text.trim();

  const matches = [...trimmed.matchAll(/```(\w+)?\n?([\s\S]*?)```/g)];
  if (matches.length > 0) {
    const code = matches[matches.length - 1][2].trim();
    if (code) return code;
  }

  return '';
}

export abstract class Agent {
  protected llm: LLMClient;
  protected workspace: string;
  protected name: string;
  protected tools: ToolSet;
  protected verbose: boolean;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.workspace = config.workspace;
    this.verbose = config.verbose || false;
    this.llm = new LLMClient(config);
    this.tools = createFileTools(config.workspace);
  }

  abstract getSystemPrompt(inputPath: string, outputPath: string): string;

  getThinkingOptions(): ChatOptions {
    return { thinking: { type: 'disabled' } };
  }

  protected async getInputMessage(inputPath: string): Promise<string> {
    const full = path.join(this.workspace, inputPath);
    try {
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        return `请使用 readFile 工具读取工作目录中的文件了解内容，然后完成任务。工作目录包含：${inputPath}`;
      }
    } catch { }
    return `请使用 readFile 工具读取 "${inputPath}" 了解内容，然后完成任务。`;
  }

  async run(inputPath: string, outputPath: string): Promise<string> {
    const sharedPrefix = '你是 Deep-Demo 多Agent协作系统成员。工作目录在 ./workspace，所有文件用 writeFile 写入。\n\n';
    const chatOptions = {
      ...this.getThinkingOptions(),
      agentName: this.name,
      verbose: this.verbose,
    };
    const { text } = await this.llm.chat(
      sharedPrefix + this.getSystemPrompt(inputPath, outputPath),
      await this.getInputMessage(inputPath),
      this.tools,
      chatOptions
    );

    const outputFull = path.join(this.workspace, outputPath);

    try {
      const stat = await fs.stat(outputFull);
      if (stat.isDirectory()) {
        return text;
      }
      return text;
    } catch { }

    await fs.mkdir(path.dirname(outputFull), { recursive: true });
    const content = extractCodeBlocks(text);
    if (content) {
      await fs.writeFile(outputFull, content, 'utf-8');
    }

    return text;
  }
}
