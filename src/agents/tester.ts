import { Agent } from './base.js';
import { createReadWriteTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import type { ToolSet } from '../tools.js';

export class TesterAgent extends Agent {
  constructor(config: AgentConfig) {
    super(config);
    this.tools = createReadWriteTools(config.workspace);
  }

  getSystemPrompt(inputPath: string, outputPath: string): string {
    return `你是一个 Playwright 测试工程师。根据原型代码生成端到端测试。

必守流程：
1. 先用 1-2 次 readFile 读取关键源文件（package.json 了解启动方式、App.tsx 了解 UI 结构）
2. 然后立即用 writeFile 一次性写入所有测试文件（tests/ 目录下）
3. 最后用 readFile 验证测试文件内容是否完整
禁止：逐个文件读取、读到第8步还不写测试文件

要求：
- 使用 @playwright/test 框架
- 测试主要的交互流程和 UI 元素
- 覆盖：页面加载、关键元素存在、基本交互
- 使用 writeFile 工具写入测试文件
- 测试文件放在 tests/ 目录下
- 测试 baseURL 设为 http://localhost:5173
- import { test, expect } from '@playwright/test'

如果 playwright.config.ts 不存在，使用以下模板生成：
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5173' },
});`;
  }
}
