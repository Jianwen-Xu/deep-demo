import { describe, it, expect } from 'vitest';
import {
  parseReport,
  reportContract,
  reportPath,
  reportToFeedback,
  writeBlockedNote,
} from '../src/report.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseReport', () => {
  it('parses a fenced json block', () => {
    const parsed = parseReport(`汇报如下：
\`\`\`json
{"status":"ready","summary":"8 个文件已生成","artifacts":["App.tsx"]}
\`\`\``);

    expect(parsed).not.toBeNull();
    expect(parsed!.source).toBe('fenced');
    expect(parsed!.report.status).toBe('ready');
    expect(parsed!.report.summary).toBe('8 个文件已生成');
    expect(parsed!.report.artifacts).toEqual(['App.tsx']);
  });

  it('parses a json object embedded in prose', () => {
    const parsed = parseReport(
      '先说明一下。{"status":"needs_changes","summary":"布局有问题","feedback":"把 grid 改成两列"} 以上。'
    );

    expect(parsed!.report.status).toBe('needs_changes');
    expect(parsed!.report.feedback).toBe('把 grid 改成两列');
  });

  it('fills a missing question for blocked reports and warns', () => {
    const parsed = parseReport('{"status":"blocked","summary":"需要确认数据来源"}');

    expect(parsed!.report.status).toBe('blocked');
    expect(parsed!.report.question).toBe('需要确认数据来源');
    expect(parsed!.warning).toContain('question');
  });

  it('keeps feedback-only summaries working', () => {
    const parsed = parseReport('{"status":"needs_changes","feedback":"补测试"}');

    expect(parsed!.report.summary).toBe('补测试');
  });

  it('rejects an unknown status', () => {
    expect(parseReport('{"status":"ok","summary":"x"}')).toBeNull();
  });

  it('falls back to the legacy markdown conclusion', () => {
    const parsed = parseReport('## Review 摘要\n还行\n\n## 结论\n通过 原型功能完整');

    expect(parsed!.source).toBe('legacy');
    expect(parsed!.report.status).toBe('ready');
    expect(parsed!.warning).toContain('旧版');
  });

  it('maps 需修改 to needs_changes', () => {
    const parsed = parseReport('## 结论\n需修改 页面布局存在问题');

    expect(parsed!.report.status).toBe('needs_changes');
  });

  it('returns null for unparseable text', () => {
    expect(parseReport('这里只是一段普通说明')).toBeNull();
    expect(parseReport('')).toBeNull();
  });
});

describe('reportToFeedback', () => {
  it('prefers feedback and appends issues', () => {
    const text = reportToFeedback({
      status: 'needs_changes',
      summary: 's',
      issues: [{ severity: 'blocker', detail: '页面白屏', file: 'App.tsx' }],
      feedback: '修复渲染',
      artifacts: [],
    });

    expect(text).toContain('修复渲染');
    expect(text).toContain('[blocker] 页面白屏 (App.tsx)');
  });

  it('falls back to summary when there is nothing else', () => {
    const text = reportToFeedback({
      status: 'failed',
      summary: '无法产出',
      issues: [],
      artifacts: [],
    });

    expect(text).toBe('无法产出');
  });
});

describe('reportContract', () => {
  it('names the agent report file and every status', () => {
    const contract = reportContract('reviewer');

    expect(contract).toContain(reportPath('reviewer'));
    expect(reportPath('reviewer')).toBe('reports/reviewer.json');
    for (const status of ['ready', 'needs_changes', 'blocked', 'failed']) {
      expect(contract).toContain(status);
    }
  });
});

describe('writeBlockedNote', () => {
  it('writes the question to needs-human.md', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'blocked-note-'));
    try {
      const file = await writeBlockedNote(workspace, 'Reviewer', {
        status: 'blocked',
        summary: '验收标准缺失',
        question: '这个仪表盘要展示几个指标？',
        issues: [{ severity: 'major', detail: '需求没写指标数量' }],
        artifacts: [],
      });

      const content = await readFile(file, 'utf-8');
      expect(content).toContain('这个仪表盘要展示几个指标？');
      expect(content).toContain('Reviewer');
      expect(content).toContain('需要人工介入');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
