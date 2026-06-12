# Deep-Demo

DeepSeek 驱动的多 Agent 协作原型开发系统。输入需求，自动构建 Web 原型、生成 E2E 测试并启动预览。

> 本项目所有代码全部使用 [opencode](https://opencode.ai) + DeepSeek 实现。

## 架构

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

### Agent 角色

| Agent | Thinking | Tools | 职责 |
|-------|----------|-------|------|
| Developer | `enabled` (medium) | `readFile` + `writeFile` | 按需求文档构建完整 React+Vite 原型（8 个必需文件） |
| Tester | `disabled` | `readFile` + `writeFile` | 根据源码生成 Playwright E2E 测试 |
| Reviewer | `enabled` (medium) | `readFile` + `writeFile` + `listFiles` | 审查代码质量、UI/UX、测试覆盖 |
| Orchestrator (diagnose) | `disabled` | — (context-only) | 分析测试失败原因，决策 retry_dev/retry_tester/abort |

每个 Agent 的 `chat()` 调用均传入各自 thinking 参数，DeepSeek 模型根据配置决定是否展示推理过程。

### 诊断重试机制

测试失败时，Orchestrator 调用独立 LLM 诊断工作区文件结构 + 错误输出，判断根本原因：
- `retry_dev` — 代码问题，重新运行 Developer
- `retry_tester` — 测试问题，跳过 Developer 直接重跑 Tester（`skipDev` 模式）
- `abort` — 不可恢复错误，终止管道

### 工具隔离

- **Developer / Tester**: 仅有 `readFile` + `writeFile`（无 `listFiles`），避免在空目录上浪费步骤
- **Reviewer**: 完整工具集（含 `listFiles`），需要发现和浏览所有文件
- **诊断层**: 不调用工具，通过 `ls()` 递归遍历文件树后拼接成 prompt 上下文

### KV Cache 优化

三个 Agent 共享 system prompt 前缀 `"你是 Deep-Demo 多Agent协作系统成员..."`，DeepSeek KV Cache 自动命中，后续调用输入成本降至 ¥0.02/百万 token。

## 快速开始

```bash
# 安装
npm install
npx playwright install chromium

# 配置
cp .env.example .env
# 编辑 .env 填入 LLM_API_KEY

# 编写需求
echo "写一个显示今日待办事项的网页，支持增删改" > requirements.md

# 运行
npx tsx src/index.ts --requirements requirements.md
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | DeepSeek API Key |
| `LLM_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `LLM_MODEL` | `deepseek-v4-flash` | 模型名 |
| `WORKSPACE_DIR` | `./workspace` | 工作目录（原型代码输出位置） |

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── orchestrator.ts       # 管道调度器（含 LLM 诊断层、skipDev 重试逻辑）
├── agents/
│   ├── base.ts           # 抽象 Agent 基类（getThinkingOptions() 模板方法）
│   ├── developer.ts      # 原型构建 Agent（thinking=enabled，read+write 工具）
│   ├── tester.ts         # 测试生成 Agent（thinking=disabled，read+write 工具）
│   └── reviewer.ts       # 代码审查 Agent（thinking=enabled，完整工具集）
├── llm.ts                # OpenAI SDK 封装（手动工具调用循环、超时、重试、thinking 参数）
├── tools.ts              # 工具工厂（createFileTools / createReadWriteTools / createReadTools）
├── logger.ts             # 结构化日志（时间戳 + 分级输出）
└── types.ts              # 共享类型（AgentConfig、ToolSet 等）
```

### 核心模块说明

**`orchestrator.ts`** — 管道控制器。维护 `skipDev` 标志位决定下一轮是否跳过 Developer 阶段。`diagnoseTestFailure()` 递归遍历工作区文件树作为 prompt 上下文，调用独立 LLM 实例获取 JSON 诊断结果。

**`llm.ts`** — 基于官方 `openai` SDK 的 LLM 客户端。`chat()` 方法实现手动工具调用循环（max 10 步），支持 `thinking` / `reasoning_effort` 参数透传。每次 API 调用有 120s 超时和最多 3 次自动重试（指数退避）。

**`tools.ts`** — 三种工具集工厂函数，均包含路径穿越防护（`safePath` 校验）。工具返回值统一为 `{ success: true }` / `{ error: string }` 或 `{ content: string }` / `{ files: string[] }`。

## 测试

```bash
npm test          # 项目单元测试
npm run test:run  # 单次运行
```

## 运行示例

以下为 "写一个显示今日待办事项的网页，支持增删改" 需求的完整运行日志（使用 `--verbose` 模式）：

![运行截图](docs/screenshot.png)

```
  ⚛  Deep-Demo 多 Agent 协作开发系统
  📄  需求: requirements.md
  📁  工作目录: ./workspace
  🤖  模型: deepseek-v4-flash (详细模式)

[19:37:31.622] [Orchestrator] Workspace directories created
[19:37:31.940] [Orchestrator] Pipeline run (attempt 1/4)
[19:37:31.937] [Developer   ] Building prototype...
[19:38:00.388] [developer   ]   Step 1/10 (28450ms) → 8 writeFile calls
[19:38:00.389] [developer   ]     writeFile(path=package.json, ...)
[19:38:00.389] [developer   ]     writeFile(path=vite.config.ts, ...)
[19:38:00.389] [developer   ]     writeFile(path=tsconfig.json, ...)
[19:38:00.389] [developer   ]     writeFile(path=index.html, ...)
[19:38:00.389] [developer   ]     writeFile(path=data.ts, ...)
[19:38:00.389] [developer   ]     writeFile(path=style.css, ...)
[19:38:00.389] [developer   ]     writeFile(path=main.tsx, ...)
[19:38:00.389] [developer   ]     writeFile(path=App.tsx, ...)
[19:38:06.338] [developer   ]   Done in 2 steps (34400ms)
[19:38:06.338] [Developer   ] Building prototype done (34401ms)
[19:38:06.339] [Orchestrator] Installing dependencies...
[19:38:10.938] [Orchestrator] Installing dependencies done (4599ms)
[19:38:10.938] [Orchestrator] Starting dev server...
[19:38:11.584] [Orchestrator] Preview URL: http://localhost:5173/
[19:38:11.584] [Orchestrator] Starting dev server done (646ms)
[19:38:11.584] [Tester      ] Generating e2e tests...
[19:38:13.611] [tester      ]   Step 1/10 (2026ms) → 3 readFile
[19:38:16.134] [tester      ]   Step 2/10 (2520ms) → 1 readFile
[19:38:33.590] [tester      ]   Step 3/10 (17454ms) → 1 writeFile
[19:38:35.198] [tester      ]   Step 4/10 (1607ms) → 1 readFile
[19:38:41.665] [tester      ]   Done in 5 steps (30080ms)
[19:38:41.666] [Tester      ] Generating e2e tests done (30082ms)
[19:38:41.666] [Orchestrator] Running e2e tests...
[19:38:56.350] [Orchestrator] Tests failed (19/22 passed)
[19:38:56.352] [Orchestrator] Diagnosing test failure...
[19:39:00.137] [Orchestrator]   Done in 1 step (3785ms)
[19:39:00.137] [Orchestrator] Pipeline run (attempt 2/4)
[19:39:00.440] [Developer   ] Fixing prototype from review feedback...
...
```
