# Multi-Agent Code Development System

# 多Agent协作开发系统

A multi-agent collaborative system that takes user requirements and automatically develops code, generates tests, and performs review.

一个多Agent协作系统，接收用户需求后自动开发代码、生成测试并执行审查。

## Features / 功能

- **Orchestrator**: Task decomposition and agent scheduling / 任务拆解与Agent调度
- **Developer Agent**: Generates TypeScript code from requirements / 根据需求生成TypeScript代码
- **Tester Agent**: Generates and runs unit tests with vitest / 使用vitest生成并运行单元测试
- **Reviewer Agent**: Reviews code quality and provides feedback / 审查代码质量并提供反馈
- **Retry mechanism**: Auto-retry when review fails / 审查失败时自动重试（最多3次）

## Tech Stack / 技术栈

- TypeScript + Node.js
- Vercel AI SDK (`ai` + `@ai-sdk/openai`)
- Zod (schema validation)
- Vitest (testing)

## Quick Start / 快速开始

### 1. Install dependencies / 安装依赖

```bash
npm install
```

### 2. Configure environment / 配置环境变量

```bash
cp .env.example .env
```

Edit `.env` with your LLM API credentials:

```
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
WORKSPACE_DIR=./workspace
```

### 3. Create requirements file / 创建需求文件

```bash
echo "Write a simple addition function that accepts two numbers and returns their sum" > requirements.md
```

### 4. Run / 运行

```bash
npx tsx src/index.ts --requirements requirements.md
```

### 5. Check output / 查看输出

```bash
cat workspace/src/index.ts          # Generated code / 生成的代码
cat workspace/tests/index.test.ts   # Generated tests / 生成的测试
cat workspace/reviews/review.md     # Review feedback / 审查反馈
```

## Project Structure / 项目结构

```
src/
├── index.ts              # CLI entry point / CLI入口
├── orchestrator.ts       # Task scheduling / 任务调度
├── agents/
│   ├── base.ts           # Agent base class / Agent基类
│   ├── developer.ts      # Code generation / 代码生成
│   ├── tester.ts         # Test generation / 测试生成
│   └── reviewer.ts       # Code review / 代码审查
├── llm.ts                # LLM client (Vercel AI SDK) / LLM客户端
├── tools.ts              # File operation tools / 文件操作工具
└── types.ts              # Type definitions / 类型定义
```

## How It Works / 工作原理

```
User Requirements
       │
       ▼
┌─────────────┐
│ Orchestrator │ ── Analyze & decompose / 分析拆解
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Developer  │ ── Generate code / 生成代码
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Tester    │ ── Generate & run tests / 生成运行测试
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Reviewer   │ ── Review code / 审查代码
└─────────────┘
```

## Testing / 测试

```bash
npm test          # Watch mode / 监听模式
npm run test:run  # Single run / 单次运行
```

## License / 许可

ISC
