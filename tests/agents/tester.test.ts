import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TesterAgent } from '../../src/agents/tester.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue({ text: 'test code' });
  }),
}));

vi.mock('../../src/tools.js', () => ({
  createFileTools: vi.fn().mockReturnValue({ definitions: [], executors: {} }),
  createReadWriteTools: vi.fn().mockReturnValue({ definitions: [], executors: {} }),
}));

describe('TesterAgent', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'tester-test-'));
    await mkdir(join(workspace, 'tests'), { recursive: true });
    await mkdir(join(workspace, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates instance with config', () => {
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    expect(agent).toBeDefined();
  });

  it('system prompt mentions playwright and writeFile', () => {
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const prompt = agent.getSystemPrompt('.', 'tests');
    expect(prompt).toContain('@playwright/test');
    expect(prompt).toContain('writeFile');
    expect(prompt).toContain('http://localhost:5173');
  });

  it('run() reads input and returns LLM output', async () => {
    await writeFile(join(workspace, 'src', 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
    await mkdir(join(workspace, 'tests'), { recursive: true });
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const result = await agent.run('src/index.ts', 'tests/index.test.ts');
    expect(result).toBe('test code');
  });

  it('injects diagnostic feedback into the input message', async () => {
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    agent.setDiagnosticFeedback('选择器 .card 匹配到了多个元素');

    await agent.run('.', 'tests');

    const chat = (agent as any).llm.chat as ReturnType<typeof vi.fn>;
    const userMessage = chat.mock.calls[0][1] as string;
    expect(userMessage).toContain('选择器 .card 匹配到了多个元素');
  });

  it('leaves the input message untouched without feedback', async () => {
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });

    await agent.run('.', 'tests');

    const chat = (agent as any).llm.chat as ReturnType<typeof vi.fn>;
    const userMessage = chat.mock.calls[0][1] as string;
    expect(userMessage).not.toContain('上一轮端到端测试失败');
  });
});
