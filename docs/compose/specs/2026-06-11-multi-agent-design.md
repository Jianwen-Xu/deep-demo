# [S1] Problem

构建一个多Agent协作的端到端代码开发系统。用户描述需求后，系统自动拆解任务、开发代码、生成测试、执行Review，输出完整可用的代码。

# [S2] Solution Overview

采用轻量自建方案，使用 TypeScript + Vercel AI SDK + 文件共享通信，实现四个Agent角色协作：

- **Orchestrator**：分析需求、拆解任务、调度下游Agent
- **Developer**：根据任务文件生成代码
- **Tester**：根据代码生成测试并运行
- **Reviewer**：审查代码和测试质量，输出Review意见

Agent之间通过共享workspace目录中的文件进行通信，使用Vercel AI SDK处理LLM调用和tool calling。

# [S3] Architecture

```
用户输入需求 (requirements.md)
        │
        ▼
┌─────────────────┐
│   Orchestrator  │  分析需求 → 拆子任务 → 写入 tasks/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Developer     │  读取任务 → 生成代码 → 写入 src/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Tester        │  读取代码 → 生成测试 → 写入 tests/ → 运行测试
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Reviewer      │  读取代码+测试 → 输出review → reviews/
└─────────────────┘
```

# [S4] Shared Workspace Structure

```
workspace/
├── requirements.md      ← 用户输入需求
├── tasks/               ← Orchestrator 拆解的子任务
│   ├── 01-模块名.md
│   └── 02-模块名.md
├── src/                 ← Developer 生成的代码
│   └── ...
├── tests/               ← Tester 生成的测试
│   └── ...
├── reviews/             ← Reviewer 的审查意见
│   └── review-01.md
└── .status              ← 全局状态文件
```

# [S5] Tech Stack

- **运行时**：Node.js + TypeScript
- **LLM**：国产模型（DeepSeek/Qwen/GLM），通过 OpenAI 兼容 API
- **LLM交互层**：Vercel AI SDK (`ai` 包 + `@ai-sdk/openai`)
- **工具定义**：Vercel AI SDK 的 `tool()` 函数 + zod 参数校验
- **通信**：文件共享 + 文件锁
- **包管理**：npm

# [S6] Core Components

## LLMClient
封装 Vercel AI SDK，提供统一的 `chat(system, user, tools)` 接口。支持通过环境变量配置模型、API Key、Base URL。

## Agent 基类
抽象基类，每个Agent实现 `getSystemPrompt()` 和 `getTools()`。基类提供 `run()` 方法：读取输入文件 → 调用LLM → 写出输出文件。

## 工具系统
基于 AI SDK 的 `tool()` 定义：
- `readFile` / `writeFile` / `listFiles`：文件操作
- `executeCommand`：执行shell命令（用于运行测试）
- 每个Agent可以有自己的专属工具

## Orchestrator
- 接收用户需求，调用LLM拆解为子任务
- 按序触发 Developer → Tester → Reviewer
- 如果 Review 不通过，反馈给 Developer 修改
- 汇总最终结果

# [S7] Agent Roles

| Agent | 输入 | 输出 | 工具 |
|-------|------|------|------|
| Orchestrator | requirements.md | tasks/*.md | readFile, writeFile |
| Developer | tasks/*.md | src/* | readFile, writeFile |
| Tester | src/* | tests/*, test-report.md | readFile, writeFile, executeCommand |
| Reviewer | src/*, tests/*, test-report.md | reviews/*.md | readFile |

# [S8] Error Handling

- LLM 调用失败：重试3次，失败后标记任务为 blocked
- 测试失败：Tester 输出失败详情，Reviewer 可以指出问题
- Review 不通过：Orchestrator 将反馈发回 Developer 修改
- 最大循环次数：Developer-Tester-Reviewer 最多循环3次

# [S9] Configuration

通过环境变量配置：
- `LLM_API_KEY`：模型 API Key
- `LLM_BASE_URL`：API 地址
- `LLM_MODEL`：模型名称
- `WORKSPACE_DIR`：工作目录路径

通过命令行参数指定：
- `--需求文件`：输入需求文件路径
- `--工作目录`：workspace 路径
