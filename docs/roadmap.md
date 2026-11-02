# Roadmap：从「一次性流水线」到「可恢复的 Agent 运行」

本路线图承接 [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) 的可借鉴部分，但只取四条原则，不引入它的领域模型：

1. **显式阶段**：用「在等什么」描述任务状态，而不是用 `attempt` 数字。
2. **结构化汇报**：Agent 之间传 JSON 事实，不传需要正则猜的 markdown。
3. **先落库再执行**：外部动作先记录、再执行，失败可重试且不重复。
4. **人机边界**：只有人能解的问题就停下并提问，不烧重试次数。

参考文档：[003 Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)（阶段表、并发槽位）、[007 Architecture](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md)（Store / Outbox / Engine 分层）。

---

## Step 1 — 显式阶段 + 结构化汇报（已完成）

**改了什么**

| 能力 | 位置 |
| --- | --- |
| `Report` 类型、zod 校验、容错解析、旧版 markdown 兜底 | `src/report.ts` |
| 汇报契约（拼进所有 Agent 的 system prompt 尾部） | `src/report.ts` `reportContract()` |
| 阶段机 `queued → working → {done, blocked, failed}` | `src/stage.ts` |
| 流水线只依据 `status` 决策；`blocked` 立即终止 | `src/orchestrator.ts` |
| 退出码 `0 / 1 / 2` + `needs-human.md` | `src/index.ts`、`src/report.ts` |

**行为变化**

- 成功不再靠 `/^## 结论\s*\n\s*通过/` 正则，而是 `reviewer.json` 里的 `status === "ready"`。
- `blocked` 不消耗后续重试：第一轮就停，写出 `needs-human.md` 并以退出码 `2` 结束。
- 缺汇报 / 汇报非法 → 按 `failed` 处理并进入下一轮，而不是当成成功。
- 每轮开始前删除上一轮的汇报文件，避免旧结论污染新决策。

**尚未解决**

- 状态只在内存里：进程挂掉后 `--resume` 无从谈起。
- 所有任务共用 `workspace/`，重试会污染上一轮产物，也无法并行。
- `blocked` 是终局，人回答之后只能整体重跑。

---

## Step 2 — 持久化与恢复（下一步，预计 3–5 天）

**目标**：任何时刻 `Ctrl-C` / 断电 / API 崩溃，都能从最后一个阶段继续，而不是从 Developer 重跑。

**设计**

```
src/state/store.ts
  interface StateStore { load(): Promise<RunState | null>; save(s: RunState): Promise<void>; }
  class FileStateStore implements StateStore   // <workspace>/.demo/state.json
```

- **原子写**：写 `state.json.tmp` → `fsync` → `rename`，避免半截文件。
- **版本化**：`state.json` 带 `version`，用 zod 校验；损坏时重命名为 `state.json.bak` 并从 `queued` 重建，不阻塞运行。
- **身份校验**：`RunState` 增加 `taskId`、`requirementsHash`（需求文件 sha256）。`requirementsHash` 不匹配时拒绝恢复，避免「A 需求的状态跑 B 需求」。
- **恢复语义**（对齐参考实现的 `assignmentInterrupted`）：
  - `queued` / `working` → 从当前 attempt 继续，并写入 `tasks/recovery.md`：说明上一轮在哪个阶段中断、已有哪些产物、**先检查再动手，不要重复写文件**。
  - `blocked` → 保持 `blocked`，等人回答（Step 5 提供 `--answer`）。
  - `done` / `failed` → 默认不恢复；`--resume --force` 可强制重跑。
- **落盘点**：每次阶段迁移、每次收到 Report、每个 attempt 结束、SIGINT/SIGTERM。

**验收标准**

- [ ] 跑到一半 `kill -9`，`--resume` 能从同一 attempt 继续，不重复 npm install。
- [ ] 手工把 `state.json` 写成 `{{{`，下次启动能自愈并打印警告。
- [ ] 换掉 `requirements.md` 后 `--resume` 被拒绝，提示改用新任务。
- [ ] 单测覆盖原子写、版本迁移、hash 不匹配三种情况。

**涉及文件**：`src/state/store.ts`（新）、`src/stage.ts`、`src/orchestrator.ts`、`src/index.ts`（`--resume`）。

---

## Step 3 — 任务目录隔离 + 并发槽位（预计 3–4 天）

**目标**：同时跑多个需求不互相踩；单个任务失败后能保留现场复现。

**设计**

- 每个任务一个运行目录：`runs/<taskId>/`（`taskId` = 需求名 + 短 hash）。`workspace` 从「全局目录」变成「某个 run 的目录」，所有 Agent 与 dev server 都在里面工作。
- 端口不再固定 5173：向系统要一个空闲端口（`net.createServer().listen(0)`），把 URL 写进 `RunState`，Tester 的 `baseURL` 从环境变量读。
- `SlotPool`：默认 `--workers 1`，与现在行为一致；`--workers N` 才并发。
- **借鉴点**：给人发起的重跑/回答预留一个额外槽位，使其不必排队等自动任务（参考 003 的 "extra slot for a person" 规则）。当前没有人工入口，这条随 Step 5 一起生效。

**验收标准**

- [ ] `--workers 2` 跑两个需求，产物目录、端口、测试结果互不影响。
- [ ] 失败任务目录保留，`--workspace runs/<id>` 可单独复现。
- [ ] 槽位满时新任务显示 `queued` 而不是覆盖别人的 `workspace/`。

**前置**：Step 2（`RunState` 需要携带 run 目录与端口）。

---

## Step 4 — Outbox：外部动作先落库再执行（按需，预计 2–3 天）

**目标**：任何「发出去就收不回」的动作都不丢、不重。

**现状**：当前唯一的外部动作是写文件和起 dev server，可靠性要求低，所以这一步**推迟到接入 GitHub PR / 通知 / 部署时再做**，不要提前引入。

**设计**

- 新增 `effects` 记录：`{ id, kind, payload, status: pending|sent|failed, attempts, lastError, nextAt }`。
- 顺序固定：**同一个事务里写状态 + 写 effect，提交后再执行**（参考 007 的 Outbox）。
- 失败重试：2s 起、倍增到 60s；连续三次失败才在 `reports/` 里报「系统问题」，不在 UI 上刷错误。
- 幂等键：每条 effect 带稳定 id（如 `ticket:attempt:kind`），重放不会重复发送。

**验收标准**

- [ ] 模拟发送失败三次，effect 仍留在 `pending`，恢复后只发出一次。
- [ ] 进程在「已落库、未发送」之间崩溃，重启后补发。

---

## Step 5 — 人的回路：`awaiting_review` 与 `--answer`（预计 2–3 天）

**目标**：把 `blocked` 从「终局」变成「可续跑的等待态」，并让人能验收结果。

**设计**

- 阶段表补两格：
  - `awaiting_review`：Reviewer 报 `ready` 后不直接 `done`，等一次人工确认。默认自动通过（`--yes`）以免打断自动化，显式传 `--review` 时才停下等人。
  - `blocked` 时 `--answer "…"`：把回答作为一条 Input 交给当前 Agent，阶段回到 `working`，不复用整条流水线。
- `needs-human.md` 从「一个问题」升级为「待办清单」：每个未决问题一行，标注来源 Agent 与建议的默认答案。
- 借鉴点：参考实现的 `waitsForPerson` —— 在 `blocked` 之后，**自动输入一律不投递**，只有人的消息能唤醒，避免 CI 噪音反复触发失败。

**验收标准**

- [ ] `blocked` 后执行 `--answer`，从同一 attempt 续跑，日志显示回答被投递给哪个 Agent。
- [ ] `awaiting_review` 下不产生新的 LLM 调用。

**前置**：Step 2（没有持久化，回答无从 attach 到任务）。

---

## 明确不做

以下来自参考实现，但对 1k 行级别的原型工具收益为负：

- `Source` / `Thread` / `Subscription` / `Mandate` / `Eval` 等完整领域模型。
- 准入矩阵（allowed sender、admission table、观察模式）。
- 管理面板、双语 i18n。
- 多仓库、多账号、常驻守护进程。

需要这些能力时，正确做法是**把执行层交给 DeepSeek Harness**，而不是在本项目里重新实现一遍。

---

## 衡量指标

每一步落地后都应记录，避免「优化了但说不清好在哪里」：

| 指标 | 采集方式 | 期望 |
| --- | --- | --- |
| 首次通过率 | `reports/reviewer.json` 的 status 分布 | Step 1 后建立基线 |
| 平均轮次 | `RunState.attempt` | 逐步下降 |
| `blocked` 占比 | 阶段迁移记录 | 能区分「真需要人」与「Agent 偷懒」 |
| 单任务 token / 耗时 | 日志时间戳 + API usage | 不因新增阶段上升 |
| 恢复成功率 | `--resume` 结果 | Step 2 后 ≥ 95% |

---

## 里程碑

| 阶段 | 主题 | 预计 | 依赖 |
| --- | --- | --- | --- |
| Step 1 | 阶段 + 汇报 | ✅ 已完成 | — |
| Step 2 | 持久化与恢复 | 3–5 天 | Step 1 |
| Step 3 | 目录隔离 + 并发 | 3–4 天 | Step 2 |
| Step 4 | Outbox | 2–3 天（按需） | Step 3 |
| Step 5 | 人的回路 | 2–3 天 | Step 2 |
