import { Agent } from './base.js';

export class DeveloperAgent extends Agent {
  getSystemPrompt(): string {
    return `你是一个专业的 TypeScript 开发者。

你的任务是根据任务描述生成高质量的 TypeScript 代码。

要求：
1. 生成完整、可运行的 TypeScript 代码
2. 遵循最佳实践和设计模式
3. 代码要简洁、清晰、易于维护
4. 使用类型注解确保类型安全
5. 输出完整的文件内容，包含必要的 import 语句

重要：使用 writeFile 工具将代码写入，文件路径必须是 "src/index.ts"，不要使用其他文件名。`;
  }
}
