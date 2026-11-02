import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { join } from 'node:path';

/**
 * 验证“汇报驱动”的两个关键行为：
 * 1. Developer 报 blocked → 流水线立即终止，不再重试，并写出 needs-human.md
 * 2. Developer 报 needs_changes → 把 feedback 落成下一轮的输入
 */
const h = vi.hoisted(() => ({
  script: [] as Array<Record<string, unknown>>,
  inputs: [] as string[],
}));

vi.mock('../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(function () {
    this.chat = vi.fn().mockResolvedValue({ text: 'mock output' });
  }),
}));

vi.mock('../src/agents/developer.js', () => ({
  DeveloperAgent: class {
    private workspace: string;
    constructor(config: { workspace: string }) {
      this.workspace = config.workspace;
    }
    async run(inputPath: string) {
      h.inputs.push(inputPath);
      const report = h.script.shift() ?? { status: 'ready', summary: 'done' };
      await fs.mkdir(join(this.workspace, 'reports'), { recursive: true });
      await fs.writeFile(
        join(this.workspace, 'reports', 'developer.json'),
        JSON.stringify(report),
        'utf-8'
      );
      return '';
    }
  },
}));

const { Orchestrator } = await import('../src/orchestrator.js');

describe('Orchestrator report-driven flow', () => {
  let workspace: string;
  let requirementsFile: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-flow-'));
    requirementsFile = path.join(workspace, 'input-req.md');
    await fs.writeFile(requirementsFile, '# Requirements\nBuild a dashboard');
    h.script = [];
    h.inputs = [];
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const makeOrch = () => new Orchestrator({
    workspace,
    apiKey: 'test-key',
    baseURL: 'https://api.test.com',
    model: 'test-model',
  });

  it('stops at once on blocked and writes needs-human.md', async () => {
    h.script = [{
      status: 'blocked',
      summary: '需求没写要展示哪些指标',
      question: '仪表盘需要展示哪几个指标？',
    }];

    const orch = makeOrch();
    await orch.init();
    const outcome = await orch.run(requirementsFile);

    expect(outcome).toBe('blocked');
    expect(orch.getState().stage).toBe('blocked');
    expect(orch.getState().attempt).toBe(1);
    expect(h.inputs).toEqual(['requirements.md']);

    const note = await fs.readFile(join(workspace, 'needs-human.md'), 'utf-8');
    expect(note).toContain('仪表盘需要展示哪几个指标？');
  });

  it('feeds needs_changes back into the next developer round', async () => {
    h.script = [
      { status: 'needs_changes', summary: '少了数据文件', feedback: '补 data.ts' },
      { status: 'blocked', summary: '人工确认', question: '确认数据来源？' },
    ];

    const orch = makeOrch();
    await orch.init();
    const outcome = await orch.run(requirementsFile);

    expect(outcome).toBe('blocked');
    expect(h.inputs).toEqual(['requirements.md', 'tasks/review-feedback.md']);

    const feedback = await fs.readFile(join(workspace, 'tasks', 'review-feedback.md'), 'utf-8');
    expect(feedback).toContain('补 data.ts');
    expect(orch.getState().attempt).toBe(2);
  });
});
