# Deep-Demo

DeepSeek 驱动的多 Agent 协作原型开发系统。输入需求，自动构建 Web 原型、生成 E2E 测试并启动预览。

A DeepSeek-powered multi-agent collaborative prototyping system. Input requirements, and it automatically builds a web prototype, generates E2E tests, and launches a live preview.

> 本项目所有代码全部使用 [opencode](https://opencode.ai) + DeepSeek 实现。
> All code in this project was generated using opencode + DeepSeek.

---

## Architecture / 架构

```
User Requirements (requirements.md)
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  Orchestrator                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │ Pipeline Loop (max 4 attempts)               │   │
│  │                                              │   │
│  │   Developer  ──► npm install ──► Dev Server  │   │
│  │       │                        │              │   │
│  │       │    ┌───────────────────┘              │   │
│  │       ▼    ▼                                  │   │
│  │   Tester ──► Playwright Tests                 │   │
│  │       │                        │              │   │
│  │       ▼                        ▼              │   │
│  │   Reviewer ◄──── (on failure)                 │   │
│  │       │                        │              │   │
│  │       ▼                        ▼              │   │
│  │   ┌──────────────────────┐                    │   │
│  │   │ LLM Diagnose Layer   │ ◄── test failures │   │
│  │   └──────────────────────┘                    │   │
│  │         │ retry_dev / retry_tester / abort    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Agent Roles / 角色

| Agent | Thinking | Tools | Responsibility / 职责 |
|-------|----------|-------|-----------------------|
| Developer | `enabled` (medium) | `readFile` + `writeFile` | 构建完整 React+Vite 原型（8 个必需文件） |
| Tester | `disabled` | `readFile` + `writeFile` | 根据源码生成 Playwright E2E 测试 |
| Reviewer | `enabled` (medium) | `readFile` + `writeFile` + `listFiles` | 审查代码质量、UI/UX、测试覆盖 |
| Orchestrator (diagnose) | `disabled` | context-only | 分析测试失败原因，决策 retry/abort |

Each agent's `chat()` call passes its own thinking parameters. DeepSeek decides whether to show the reasoning process based on the configuration.

### Diagnostic Retry / 诊断重试

Test failures trigger an independent LLM diagnosis:

- `retry_dev` — code issue, re-run Developer / 代码问题，重跑 Developer
- `retry_tester` — test issue, skip Developer, re-run Tester / 测试问题，跳过 Developer 直接重跑 Tester
- `abort` — unrecoverable / 不可恢复，终止

### Tool Isolation / 工具隔离

- **Developer / Tester**: only `readFile` + `writeFile` (no `listFiles`), preventing wasted steps on empty directories
- **Reviewer**: full toolset (including `listFiles`), needed to browse all files
- **Diagnosis**: no tools; file tree is packed into prompt via `ls()`

### KV Cache Optimization / 优化

System prompt prefix `"You are a member of the Deep-Demo multi-agent system..."` is shared across all three agents → DeepSeek KV Cache auto-hit. Input cost drops to ¥0.02/million tokens.

---

## Quick Start / 快速开始

```bash
# Install / 安装
npm install

# Configure / 配置
cp .env.example .env
# Edit .env and set your LLM_API_KEY / 编辑 .env 填入 LLM_API_KEY

# Write requirements / 编写需求
echo "a simple dashboard" > requirements.md

# Run / 运行
npx tsx src/index.ts --requirements requirements.md
```

## Environment Variables / 环境变量

| Variable | Default | Description / 说明 |
|----------|---------|--------------------|
| `LLM_API_KEY` | — | DeepSeek API Key |
| `LLM_BASE_URL` | `https://api.deepseek.com` | API endpoint / API 地址 |
| `LLM_MODEL` | `deepseek-v4-flash` | Model name / 模型名 |
| `WORKSPACE_DIR` | `./workspace` | Output directory / 原型代码输出目录 |

---

## Project Structure / 项目结构

```
src/
├── index.ts              # CLI entry / 入口
├── orchestrator.ts       # Pipeline scheduler / 管道调度器
├── agents/
│   ├── base.ts           # Abstract Agent base class / 抽象基类
│   ├── developer.ts      # Prototype builder / 原型构建 Agent
│   ├── tester.ts         # Test generator / 测试生成 Agent
│   └── reviewer.ts       # Code reviewer / 代码审查 Agent
├── llm.ts                # OpenAI SDK wrapper (tool loop, timeout, retry, thinking)
├── tools.ts              # Tool factories / 工具工厂
├── logger.ts             # Structured logger / 结构化日志
└── types.ts              # Shared types / 共享类型
```

### Core Modules / 核心模块

**`orchestrator.ts`** — Pipeline controller. Maintains a `skipDev` flag to decide whether to skip the Developer phase. `diagnoseTestFailure()` walks the workspace file tree as prompt context and calls an independent LLM for JSON diagnosis results.

管道控制器。维护 `skipDev` 标志位决定下一轮是否跳过 Developer。`diagnoseTestFailure()` 递归遍历工作区文件树作为 prompt 上下文，调用独立 LLM 获取 JSON 诊断结果。

**`llm.ts`** — LLM client built on the official `openai` SDK. The `chat()` method implements a manual tool call loop (max 10 steps), supports `thinking` / `reasoning_effort` passthrough. 120s timeout, up to 3 retries (exponential backoff).

基于官方 `openai` SDK 的 LLM 客户端。`chat()` 实现手动工具调用循环（最多 10 步），支持 `thinking` / `reasoning_effort` 参数透传。120s 超时，最多 3 次指数退避重试。

**`tools.ts`** — Three tool set factories, all with path traversal protection (`createSafePath` with cached `realpath`). Returns are uniformly `{ success: true }` / `{ error: string }` or `{ content: string }` / `{ files: string[] }`.

三种工具集工厂函数，均含路径穿越防护（闭包缓存 `realpath`）。返回值统一为 `{ success: true }` / `{ error: string }` 或 `{ content: string }` / `{ files: string[] }`。

---

## Test / 测试

```bash
npm test          # Run unit tests / 运行单元测试
npm run test:run  # Single run / 单次运行
```

## Example Run / 运行示例

Below is the run log for `a simple dashboard` (with `--verbose`):

以下为 `a simple dashboard` 需求的运行日志（`--verbose` 模式）：

![Screenshot](docs/screenshot.png)

```
  ⚛  Deep-Demo Multi-Agent Prototyping System
  📄  Requirements: requirements.md
  📁  Workspace: ./workspace
  🤖  Model: deepseek-v4-flash (verbose mode)

[12:24:07.012] [Orchestrator] Workspace directories created
[12:24:07.316] [Developer   ] Building prototype...
[12:24:51.313] [developer   ]   Step 1/10 (43994ms) → 8 writeFile calls
[12:24:56.532] [developer   ]   Done in 2 steps (49213ms)
[12:25:27.811] [Orchestrator] Installing dependencies...
[12:25:34.317] [Orchestrator] Installing dependencies done (6506ms)
[12:25:34.317] [Orchestrator] Installing Playwright browsers...
[12:26:03.239] [Orchestrator] Installing Playwright browsers done (28922ms)
[12:26:03.430] [Orchestrator] Preview URL: http://localhost:5173/
[12:26:23.804] [Tester      ] Generating e2e tests...
[12:26:26.799] [Orchestrator] Running e2e tests...
[12:26:26.801] [Orchestrator] Tests failed (8/9 passed)
[12:26:29.010] [Orchestrator] Diagnosing test failure...
[12:26:29.010] [Orchestrator] Pipeline run (attempt 2/4)
[12:26:29.318] [Developer   ] Fixing prototype from review feedback...
...
[12:28:07.338] [Orchestrator] Pipeline completed successfully
[12:28:07.338] [Orchestrator] Preview URL: http://localhost:5173/
```
