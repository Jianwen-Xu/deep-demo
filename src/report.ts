import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

/**
 * 结构化汇报（Report）。
 *
 * 每个 Agent 结束前必须落一份 JSON 汇报，Orchestrator 只依据 status 决策，
 * 不再用正则去 markdown 里猜“通过 / 需修改”。
 */

export const REPORT_STATUSES = ['ready', 'needs_changes', 'blocked', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ReportIssue {
  severity: Severity;
  detail: string;
  file?: string;
}

export interface Report {
  status: ReportStatus;
  summary: string;
  issues: ReportIssue[];
  /** 给下一轮执行者的具体修订指令，needs_changes 时应有值 */
  feedback?: string;
  /** status=blocked 时，向人提出的一个可回答的问题 */
  question?: string;
  artifacts: string[];
}

export type ReportSource = 'json' | 'fenced' | 'legacy';

export interface ParsedReport {
  report: Report;
  source: ReportSource;
  warning?: string;
}

export const REPORT_DIR = 'reports';

/** 每个 Agent 的汇报文件相对工作区的路径 */
export function reportPath(agent: string): string {
  return `${REPORT_DIR}/${agent}.json`;
}

const issueSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
  detail: z.string().min(1),
  file: z.string().optional(),
});

const reportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  summary: z.string().optional(),
  issues: z.array(issueSchema).optional(),
  feedback: z.string().optional(),
  question: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
});

function coerceReport(value: unknown): { report: Report; warnings: string[] } | null {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) return null;

  const data = parsed.data;
  const warnings: string[] = [];
  const report: Report = {
    status: data.status,
    summary: data.summary?.trim() || data.feedback?.trim() || '(no summary)',
    issues: (data.issues ?? []).map(issue => ({
      severity: issue.severity ?? 'major',
      detail: issue.detail,
      file: issue.file,
    })),
    feedback: data.feedback?.trim() || undefined,
    question: data.question?.trim() || undefined,
    artifacts: data.artifacts ?? [],
  };

  if (report.status === 'blocked' && !report.question) {
    report.question = report.summary;
    warnings.push('blocked 汇报缺少 question，已回退为 summary');
  }
  if (report.status === 'needs_changes' && !report.feedback) {
    warnings.push('needs_changes 汇报缺少 feedback，将用 issues 生成修订指令');
  }

  return { report, warnings };
}

/**
 * 从一段自由文本里扫描出平衡的 JSON 对象。
 * 只保留包含 "status" 的对象，避免把代码示例误判为汇报。
 */
function scanBalancedObjects(raw: string): string[] {
  const found: string[] = [];
  const limit = Math.min(raw.length, 200_000);
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < limit; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = raw.slice(start, i + 1);
        if (candidate.includes('"status"')) {
          found.push(candidate);
          if (found.length >= 20) return found;
        }
        start = -1;
      }
    }
  }
  return found;
}

function jsonCandidates(raw: string): Array<{ text: string; source: ReportSource }> {
  const candidates: Array<{ text: string; source: ReportSource }> = [];

  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(raw)) !== null) {
    if (match[1].includes('"status"')) {
      candidates.push({ text: match[1], source: 'fenced' });
    }
  }

  for (const text of scanBalancedObjects(raw)) {
    candidates.push({ text, source: 'json' });
  }

  return candidates;
}

/** 旧版 markdown 结论，仅在模型没给 JSON 时兜底，并标记为 legacy */
function parseLegacy(raw: string): Report | null {
  const match = raw.match(/^#{1,6}\s*结论\s*[:：]?\s*\n*\s*(通过|需修改|不通过)/m);
  if (!match) return null;
  const passed = match[1] === '通过';
  const summaryMatch = raw.match(new RegExp(`${match[1]}[^\\n]*`));
  return {
    status: passed ? 'ready' : 'needs_changes',
    summary: (summaryMatch?.[0] ?? match[1]).trim(),
    issues: [],
    artifacts: [],
  };
}

/**
 * 解析一段文本里的汇报。解析不出时返回 null，由调用方降级为 failed。
 */
export function parseReport(raw: string): ParsedReport | null {
  if (!raw || !raw.trim()) return null;

  for (const candidate of jsonCandidates(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate.text.trim());
    } catch {
      continue;
    }
    const coerced = coerceReport(value);
    if (!coerced) continue;
    return {
      report: coerced.report,
      source: candidate.source,
      warning: coerced.warnings.length ? coerced.warnings.join('; ') : undefined,
    };
  }

  const legacy = parseLegacy(raw);
  if (legacy) {
    return {
      report: legacy,
      source: 'legacy',
      warning: '未找到 JSON 汇报，已回退到旧版 markdown 结论（建议升级提示词）',
    };
  }

  return null;
}

/** 读取并解析工作区里的汇报文件；文件不存在或不可解析时返回 null */
export async function readReport(filePath: string): Promise<ParsedReport | null> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
  if (!raw) return null;
  return parseReport(raw);
}

/** 把 issues 渲染成可读列表 */
export function renderIssues(report: Report): string {
  if (!report.issues.length) return '';
  return report.issues
    .map(issue => `- [${issue.severity}] ${issue.detail}${issue.file ? ` (${issue.file})` : ''}`)
    .join('\n');
}

/** 给下一轮执行者的修订指令：优先 feedback，其次 issues，最后 summary */
export function reportToFeedback(report: Report): string {
  const parts: string[] = [];
  if (report.feedback) parts.push(report.feedback);
  const issues = renderIssues(report);
  if (issues) parts.push(`## 问题列表\n${issues}`);
  if (!parts.length) parts.push(report.summary);
  return parts.join('\n\n');
}

/** 给人看的一行摘要 */
export function oneLine(report: Report): string {
  return `[${report.status}] ${report.summary}`;
}

/**
 * 汇报契约：拼进每个 Agent 的 system prompt。
 * 契约文本放在这里，保证三个 Agent 的措辞完全一致（也保住 KV cache 的公共前缀）。
 */
export function reportContract(agent: string): string {
  const file = reportPath(agent);
  return `## 汇报契约（必须遵守）

你必须在最后一步用 writeFile 写入 "${file}"，内容是一个 JSON 对象（不要 markdown 包裹），格式：

{
  "status": "ready | needs_changes | blocked | failed",
  "summary": "一句话说明本轮结果",
  "issues": [{ "severity": "blocker | major | minor", "detail": "具体问题", "file": "相关文件" }],
  "feedback": "给下一轮执行者的可执行修订指令",
  "question": "status=blocked 时，向人提出的一个具体、可回答的问题",
  "artifacts": ["本轮产出的文件路径"]
}

status 的含义，只能选一个：
- ready：本轮目标已达成，可以进入下一阶段。
- needs_changes：产物可用但有明确问题，需要同一角色的下一轮修订；feedback 必填。
- blocked：缺少只有人能提供的决策、凭据或业务规则，继续做只会浪费 token；question 必填，且必须是一句话能回答的问题。
- failed：本轮无法产出任何可用结果（例如关键输入缺失、工具不可用），且不是人的决策问题。

注意：
- 写 JSON 前先把该写的产物写完，汇报是最后一步。
- 不要为了通过而谎报 ready；不确定就报 needs_changes 并写清原因。
- blocked 会立即终止整条流水线，请只在确实需要人介入时使用。`;
}

/** 写一份给人看的“需要人工介入”说明，返回文件路径 */
export async function writeBlockedNote(
  workspace: string,
  source: string,
  report: Report
): Promise<string> {
  const file = path.join(workspace, 'needs-human.md');
  const lines = [
    '# 需要人工介入 / Needs a human',
    '',
    `- 来源 / Source: ${source}`,
    `- 时间 / At: ${new Date().toISOString()}`,
    `- 状态 / Status: ${report.status}`,
    '',
    '## 问题 / Question',
    report.question ?? report.summary,
    '',
    '## 摘要 / Summary',
    report.summary,
  ];

  const issues = renderIssues(report);
  if (issues) lines.push('', '## 问题列表 / Issues', issues);
  if (report.feedback) lines.push('', '## 建议 / Feedback', report.feedback);
  if (report.artifacts.length) {
    lines.push('', '## 产物 / Artifacts', ...report.artifacts.map(a => `- ${a}`));
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf-8');
  return file;
}
