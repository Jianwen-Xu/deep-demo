import { describe, it, expect } from 'vitest';
import { StageTracker, TERMINAL_STAGES } from '../src/stage.js';

describe('StageTracker', () => {
  it('starts in queued with one change record', () => {
    const tracker = new StageTracker(4);

    expect(tracker.stage).toBe('queued');
    expect(tracker.current.attempt).toBe(0);
    expect(tracker.current.changes).toHaveLength(1);
    expect(tracker.current.changes[0].from).toBeNull();
  });

  it('records a transition with from, to and reason', () => {
    const tracker = new StageTracker(4);
    tracker.setAttempt(1);

    const change = tracker.transition('working', '第 1 轮');

    expect(change).toMatchObject({ from: 'queued', to: 'working', reason: '第 1 轮' });
    expect(tracker.stage).toBe('working');
    expect(tracker.current.attempt).toBe(1);
    expect(tracker.current.changes).toHaveLength(2);
  });

  it('ignores a transition to the current stage', () => {
    const tracker = new StageTracker(4);
    tracker.transition('working');

    expect(tracker.transition('working', '重复')).toBeNull();
    expect(tracker.current.changes).toHaveLength(2);
  });

  it('marks blocked, failed and done as terminal', () => {
    expect(TERMINAL_STAGES.has('blocked')).toBe(true);
    expect(TERMINAL_STAGES.has('failed')).toBe(true);
    expect(TERMINAL_STAGES.has('done')).toBe(true);
    expect(TERMINAL_STAGES.has('working')).toBe(false);

    const tracker = new StageTracker(4);
    tracker.transition('blocked');
    expect(tracker.isTerminal).toBe(true);
  });

  it('uses an injectable clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const tracker = new StageTracker(4, () => fixed);

    expect(tracker.current.changes[0].at).toBe('2026-01-01T00:00:00.000Z');
  });
});
