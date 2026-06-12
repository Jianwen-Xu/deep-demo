import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TesterAgent } from '../../src/agents/tester.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue({ text: 'test code', toolCalls: [] });
  }),
}));

vi.mock('../../src/tools.js', () => ({
  createFileTools: vi.fn().mockReturnValue({}),
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

  it('run() reads input and writes output', async () => {
    await writeFile(join(workspace, 'src', 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
    await mkdir(join(workspace, 'tests'), { recursive: true });
    const agent = new TesterAgent({
      name: 'tester', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const result = await agent.run('src/index.ts', 'tests/index.test.ts');
    expect(result).toBe('test code');
  });
});
