import { Agent } from './base.js';

export class TesterAgent extends Agent {
  getSystemPrompt(inputPath: string, outputPath: string): string {
    return `你是一个测试工程师。根据提供的代码生成 vitest 测试。

要求：
- 使用 vitest 框架
- 测试所有公开的类、函数、方法
- 覆盖正常路径、边界情况、错误情况
- import 路径使用 '../src/index.js'
- 使用 readFile 工具读取源码
- 使用 writeFile 工具将测试代码写入 "${outputPath}"
- 如果 writeFile 工具不可用，将测试代码输出在代码块中
- 不要包含其他说明文字`;
  }
}
