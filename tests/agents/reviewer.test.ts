import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReviewerAgent } from '../../src/agents/reviewer.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue({ text: 'review text', toolCalls: [] });
  }),
}));

vi.mock('../../src/tools.js', () => ({
  createFileTools: vi.fn().mockReturnValue({}),
}));

describe('ReviewerAgent', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'reviewer-test-'));
    await mkdir(join(workspace, 'reviews'), { recursive: true });
    await mkdir(join(workspace, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates instance with config', () => {
    const agent = new ReviewerAgent({
      name: 'reviewer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    expect(agent).toBeDefined();
  });

  it('system prompt mentions review dimensions and writeFile', () => {
    const agent = new ReviewerAgent({
      name: 'reviewer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const prompt = agent.getSystemPrompt('src/index.ts', 'reviews/review.md');
    expect(prompt).toContain('代码');
    expect(prompt).toContain('writeFile');
    expect(prompt).toContain('readFile');
    expect(prompt).toContain('## 结论');
    expect(prompt).toContain('通过');
    expect(prompt).toContain('需修改');
  });

  it('run() reads input and writes output', async () => {
    await writeFile(join(workspace, 'src', 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
    await mkdir(join(workspace, 'reviews'), { recursive: true });
    const agent = new ReviewerAgent({
      name: 'reviewer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const result = await agent.run('src/index.ts', 'reviews/review.md');
    expect(result).toBe('review text');
  });
});
