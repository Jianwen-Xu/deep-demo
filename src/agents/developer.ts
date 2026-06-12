import { Agent } from './base.js';
import fs from 'fs/promises';
import path from 'path';

export class DeveloperAgent extends Agent {
  protected async getInputMessage(inputPath: string): Promise<string> {
    try {
      const content = await fs.readFile(path.join(this.workspace, inputPath), 'utf-8');
      if (inputPath.includes('review-feedback')) {
        return `以下是审查反馈，请根据反馈修改代码：\n\n${content}`;
      }
      return `以下是需求内容，请根据此生成代码：\n\n${content}`;
    } catch (err) {
      console.error(`[Developer] Failed to read ${inputPath}:`, err instanceof Error ? err.message : String(err));
      return `请阅读文件 "${inputPath}" 了解内容，然后完成任务。`;
    }
  }

  getSystemPrompt(inputPath: string, outputPath: string): string {
    return `你是一个专业的 TypeScript 开发者。

你的任务是生成或修改 TypeScript 代码。

两种情况：
1. 如果输入是需求文档：根据需求生成完整代码
2. 如果输入是 review 反馈：根据反馈修改代码

要求：
1. 生成完整、可运行的 TypeScript 代码
2. 遵循最佳实践和设计模式
3. 代码要简洁、清晰、易于维护
4. 使用类型注解确保类型安全
5. 输出完整的文件内容，包含必要的 import 语句
6. 使用 readFile 工具读取需求或反馈
7. 使用 writeFile 工具将代码写入文件

你可以根据需要拆分多个文件（如 src/calculator.ts、src/types.ts），所有文件放在 src/ 目录下。
主文件是 "${outputPath}"，在其中导出所有公开 API。`;
  }
}
