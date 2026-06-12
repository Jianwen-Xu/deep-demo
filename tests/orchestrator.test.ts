import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Orchestrator } from '../src/orchestrator.js';

vi.mock('../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockImplementation(async (_system: string, _user: string, tools?: Record<string, any>) => {
      if (tools?.writeFile?.execute) {
        await tools.writeFile.execute({ path: 'src/index.ts', content: 'mock code' });
      }
      return { text: 'LGTM', toolCalls: [] };
    });
  }),
}));

vi.mock('../src/tools.js', async () => {
  const fs = await import('fs/promises');
  const pathMod = await import('path');
  return {
    createFileTools: vi.fn().mockImplementation((workspace: string) => ({
      readFile: {
        execute: async ({ path: filePath }: { path: string }) => {
          try {
            const content = await fs.readFile(pathMod.join(workspace, filePath), 'utf-8');
            return { content };
          } catch {
            return { error: 'not found' };
          }
        },
      },
      writeFile: {
        execute: async ({ path: filePath, content }: { path: string; content: string }) => {
          const fullPath = pathMod.join(workspace, filePath);
          await fs.mkdir(pathMod.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf-8');
          return { success: true };
        },
      },
      listFiles: { execute: async () => ({ files: [] }) },
      executeCommand: { execute: async () => ({ stdout: '', exitCode: 0 }) },
    })),
  };
});

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
