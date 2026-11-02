/**
 * 显式阶段机。
 *
 * 旧实现里 `attempt` 这一个数字同时承担“进度 / 失败原因 / 恢复点”三种语义，
 * 所以只能整条流水线重跑。这里把“在等什么”拆成独立阶段：
 *
 *   queued  → 已受理，尚未开始
 *   working → 有 Agent 正在干活
 *   blocked → 只有人能解开（缺决策 / 缺凭据 / 缺业务规则），流水线终止
 *   failed  → 本轮或整体失败，且不是人能做决定的事
 *   done    → 验收通过
 *
 * 第二阶段的持久化会直接复用 RunState 这个结构，不需要改流水线。
 */

export const STAGES = ['queued', 'working', 'blocked', 'failed', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  queued: '排队中 / queued',
  working: '执行中 / working',
  blocked: '等待人工 / blocked',
  failed: '失败 / failed',
  done: '完成 / done',
};

/** 需要人介入或已经结束的阶段，不会再自动推进 */
export const TERMINAL_STAGES: ReadonlySet<Stage> = new Set<Stage>(['blocked', 'failed', 'done']);

export interface StageChange {
  at: string;
  from: Stage | null;
  to: Stage;
  reason?: string;
}

export interface RunState {
  stage: Stage;
  attempt: number;
  maxAttempts: number;
  changes: StageChange[];
}

export class StageTracker {
  private state: RunState;

  constructor(
    maxAttempts: number,
    private readonly now: () => Date = () => new Date()
  ) {
    this.state = {
      stage: 'queued',
      attempt: 0,
      maxAttempts,
      changes: [
        { at: this.timestamp(), from: null, to: 'queued', reason: 'created' },
      ],
    };
  }

  get current(): Readonly<RunState> {
    return this.state;
  }

  get stage(): Stage {
    return this.state.stage;
  }

  get isTerminal(): boolean {
    return TERMINAL_STAGES.has(this.state.stage);
  }

  setAttempt(attempt: number): void {
    this.state.attempt = attempt;
  }

  /**
   * 进入新阶段。同阶段重复调用不会产生变更记录，返回 null。
   */
  transition(to: Stage, reason?: string): StageChange | null {
    if (to === this.state.stage) return null;

    const change: StageChange = {
      at: this.timestamp(),
      from: this.state.stage,
      to,
      reason,
    };
    this.state.stage = to;
    this.state.changes.push(change);
    return change;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
