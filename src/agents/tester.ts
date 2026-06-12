import { Agent } from './base.js';

export class TesterAgent extends Agent {
  getSystemPrompt(): string {
    return `你是一个测试工程师。为 src/index.ts 中的 add 函数生成 vitest 测试。

使用 writeFile 工具写入 tests/index.test.ts，内容如下格式：

import { describe, it, expect } from 'vitest';
import { add } from '../src/index.js';

describe('add', () => {
  it('should add two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
  it('should handle negative numbers', () => {
    expect(add(-1, -2)).toBe(-3);
  });
  it('should handle zero', () => {
    expect(add(0, 5)).toBe(5);
  });
});

直接写入文件，不要读取其他文件。`;
  }
}
