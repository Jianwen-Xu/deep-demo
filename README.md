# Deep-Demo

DeepSeek 驱动的多 Agent 协作原型开发系统。输入需求，自动构建 Web 原型、生成 E2E 测试并启动预览。

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

以元素周期表需求为例（`requirements.md`），首次运行一次性通过：

![运行截图](docs/screenshot.png)

```
  ⚛  Deep-Demo 多 Agent 协作开发系统
  📄  需求: requirements.md
  📁  工作目录: ./workspace
  🤖  模型: deepseek-v4-flash

[19:25:03.934] [Orchestrator] Workspace directories created
[19:25:03.938] [Orchestrator] Requirements copied to workspace
[19:25:03.938] [Orchestrator] Task decomposition integrated into Developer prompt
[19:25:03.940] [Orchestrator] Pipeline run (attempt 1/4)
[19:25:04.241] [Developer   ] Building prototype...
[19:25:41.126] [developer   ]   Step 1/10 (36883ms) → 8 writeFile calls
[19:25:45.974] [developer   ]   Done in 2 steps (41731ms)
[19:25:45.975] [Developer   ] Building prototype done (41734ms)
[19:25:45.975] [Orchestrator] Installing dependencies...
[19:25:54.887] [Orchestrator] Installing dependencies done (8912ms)
[19:25:54.887] [Orchestrator] Starting dev server...
[19:25:55.496] [Orchestrator] Preview URL: http://localhost:5173/
[19:25:55.496] [Orchestrator] Starting dev server done (609ms)
[19:25:55.496] [Tester      ] Generating e2e tests...
[19:25:57.168] [tester      ]   Step 1/10 (1672ms) → 2 readFile
[19:25:58.522] [tester      ]   Step 2/10 (1352ms) → 1 readFile
[19:26:00.020] [tester      ]   Step 3/10 (1497ms) → 1 readFile
[19:26:21.294] [tester      ]   Step 4/10 (21273ms) → 2 writeFile
[19:26:22.777] [tester      ]   Step 5/10 (1479ms) → 2 readFile
[19:26:26.705] [tester      ]   Done in 6 steps (31209ms)
[19:26:26.706] [Tester      ] Generating e2e tests done (31210ms)
[19:26:26.706] [Orchestrator] Running e2e tests...
[19:26:36.993] [Orchestrator] Running e2e tests done (10287ms)
[19:26:36.993] [Reviewer    ] Reviewing prototype...
[19:26:38.693] [reviewer    ]   Step 1/10 (1700ms) → 1 listFiles
[19:26:40.928] [reviewer    ]   Step 2/10 (2234ms) → 6 readFile
[19:26:42.526] [reviewer    ]   Step 3/10 (1593ms) → 2 listFiles
[19:26:44.520] [reviewer    ]   Step 4/10 (1992ms) → 5 readFile
[19:27:11.594] [reviewer    ]   Step 5/10 (27069ms) → 1 writeFile
[19:27:15.809] [reviewer    ]   Done in 6 steps (38816ms)
[19:27:15.810] [Reviewer    ] Reviewing prototype done (38817ms)
[19:27:15.810] [Orchestrator] Pipeline completed successfully
[19:27:15.810] [Orchestrator] 原型预览地址: http://localhost:5173/
[19:27:15.810] [Orchestrator] 开发服务器将在 300 秒后自动停止

  ✅ 完成！请查看工作目录中的输出。
```
