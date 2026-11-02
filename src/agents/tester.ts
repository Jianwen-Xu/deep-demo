import { Agent } from './base.js';
import { createReadWriteTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import type { ToolSet } from '../tools.js';

export class TesterAgent extends Agent {
  /** 上一轮 retry_tester 诊断结论；非空时拼进输入消息 */
  private diagnosticFeedback = '';

  constructor(config: AgentConfig) {
    super(config);
    this.tools = createReadWriteTools(config.workspace);
  }

  /** 每轮由 Orchestrator 设置；空字符串表示本轮没有测试侧反馈 */
  setDiagnosticFeedback(text: string): void {
    this.diagnosticFeedback = text.trim();
  }

  protected async getInputMessage(inputPath: string): Promise<string> {
    const base = await super.getInputMessage(inputPath);
    if (!this.diagnosticFeedback) return base;

    return `${base}

上一轮端到端测试失败，诊断为测试本身的问题。请优先修正测试，不要改产品代码：

${this.diagnosticFeedback}`;
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
});

汇报（写完测试文件后的最后一步）：
- 写入 "reports/tester.json"，按汇报契约输出。
- ready：测试已生成，选择器与当前 UI 结构一致，可以直接跑。
- failed：源码缺少必要的结构信息（例如 App.tsx 不存在、页面渲染不出来），无法写出可运行的测试；在 feedback 里写清缺什么，交给 Developer 修订。
- blocked：验收标准需要人确认（例如需求没说清哪些功能必须覆盖），question 写清要确认什么。
- 不要因为“可能不稳定”而 blocked；先写出可运行的测试。`;
  }
}
