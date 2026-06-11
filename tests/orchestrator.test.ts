import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Orchestrator } from '../src/orchestrator.js';

vi.mock('../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue('LGTM');
  }),
}));

vi.mock('../src/tools.js', () => ({
  createFileTools: vi.fn().mockReturnValue({}),
}));

describe('Orchestrator', () => {
  let workspace: string;
  let requirementsFile: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-test-'));
    requirementsFile = path.join(workspace, 'input-req.md');
    await fs.writeFile(requirementsFile, '# Requirements\nBuild a calculator');
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('should create instance with config', () => {
    const orch = new Orchestrator({
      workspace,
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      model: 'test-model',
    });
    expect(orch).toBeDefined();
  });

  it('init() should create workspace directories', async () => {
    const orch = new Orchestrator({
      workspace,
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      model: 'test-model',
    });

    await orch.init();

    for (const dir of ['tasks', 'src', 'tests', 'reviews']) {
      const stat = await fs.stat(path.join(workspace, dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('run() should copy requirements and execute pipeline', async () => {
    const orch = new Orchestrator({
      workspace,
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      model: 'test-model',
    });

    await orch.init();
    await orch.run(requirementsFile);

    const copied = await fs.readFile(path.join(workspace, 'requirements.md'), 'utf-8');
    expect(copied).toBe('# Requirements\nBuild a calculator');
  });
});
