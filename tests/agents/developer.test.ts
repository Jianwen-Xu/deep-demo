import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeveloperAgent } from '../../src/agents/developer.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue({ text: 'mock code output', toolCalls: [] });
  }),
}));

vi.mock('../../src/tools.js', () => ({
  createFileTools: vi.fn().mockReturnValue({}),
}));

describe('DeveloperAgent', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dev-test-'));
    await mkdir(join(workspace, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates instance with config', () => {
    const agent = new DeveloperAgent({
      name: 'developer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    expect(agent).toBeDefined();
  });

  it('system prompt mentions frontend development and writeFile', () => {
    const agent = new DeveloperAgent({
      name: 'developer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const prompt = agent.getSystemPrompt('req.md', 'package.json');
    expect(prompt).toContain('原型');
    expect(prompt).toContain('writeFile');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('Vite');
  });

  it('run() reads input and falls back to writing output file', async () => {
    await writeFile(join(workspace, 'req.md'), 'build a calculator');
    const agent = new DeveloperAgent({
      name: 'developer', workspace, apiKey: 'k', baseURL: 'u', model: 'm',
    });
    const result = await agent.run('req.md', 'src/index.ts');
    expect(result).toBe('mock code output');
  });
});
