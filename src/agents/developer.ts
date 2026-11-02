import { Agent } from './base.js';
import { createReadWriteTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import type { ToolSet } from '../tools.js';
import type { ChatOptions } from '../llm.js';
import fs from 'fs/promises';
import path from 'path';

export class DeveloperAgent extends Agent {
  constructor(config: AgentConfig) {
    super(config);
    this.tools = createReadWriteTools(config.workspace);
  }

  getThinkingOptions(): ChatOptions {
    return { thinking: { type: 'enabled' }, reasoningEffort: 'medium' };
  }

  protected async getInputMessage(inputPath: string): Promise<string> {
    try {
      const content = await fs.readFile(path.join(this.workspace, inputPath), 'utf-8');
      if (inputPath.includes('review-feedback')) {
        return `以下是审查反馈，请根据反馈修改原型：\n\n${content}`;
      }
      return `以下是需求内容，请根据此构建原型：\n\n${content}`;
    } catch (err) {
      console.error(`[Developer] Failed to read ${inputPath}:`, err instanceof Error ? err.message : String(err));
      return `请阅读文件 "${inputPath}" 了解内容，然后完成任务。`;
    }
  }

  getSystemPrompt(_inputPath: string, _outputPath: string): string {
    return `你是一个全栈原型开发专家。根据需求快速构建可运行的前端 Web 原型。

使用 React + Vite (TypeScript) 技术栈。

必生文件清单（全部放在工作区根目录，不要用 src/ 目录）：
1. package.json — 包含 dev（vite）、build、test（playwright test）脚本，声明所有依赖
2. vite.config.ts — Vite 配置（含 @vitejs/plugin-react）
3. tsconfig.json — TypeScript 配置
4. index.html — 入口 HTML
5. main.tsx — React 入口，渲染 <App />
6. App.tsx — 主组件，实现完整交互功能
7. data.ts — 数据文件（如元素数据、配置等）
8. style.css — 全局样式，美观配色

要求：
- 使用 writeFile 工具一次性并行写入所有文件
- 生成美观、可交互的原型，注意视觉设计和用户体验
- 项目要能够通过 npm install && npm run dev 直接运行

汇报（最后一步，先写完所有文件再写）：
- 写入 "reports/developer.json"，按汇报契约输出。
- ready：8 个文件齐全，package.json 的依赖和脚本正确。
- needs_changes：还有明确的遗留问题（例如某个文件暂时占位），feedback 写清下一步要补什么。
- blocked：需求自相矛盾，或必须由人决定业务规则（例如数据字段含义）才能继续，此时 question 必须是一句话能回答的问题。
- failed：无法产出可用项目（例如工具报错）。
- 需求没写清的细节请自行做合理选择，并把选择写进 summary，不要因此 blocked。`;
  }
}
