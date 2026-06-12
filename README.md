# Deep-Demo

DeepSeek 驱动的多 Agent 协作原型开发系统。输入需求，自动构建 Web 原型并启动预览。

## 架构

```
User Requirements
       │
       ▼
┌─────────────┐
│ Orchestrator │ ── 调度 Developer → Tester → Reviewer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Developer  │ ── 用 DeepSeek V4-Flash 构建原型
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ npm install │ ── 安装依赖
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Dev Server  │ ── 启动 Vite 预览
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Tester    │ ── 生成并运行 Playwright 测试
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Reviewer   │ ── 审查代码质量
└─────────────┘
```

使用 DeepSeek KV Cache：三个 Agent 共享 system prompt 前缀，后续调用自动命中缓存（输入成本降至 ¥0.02/百万 token）。

## 快速开始

```bash
# 安装
npm install
npx playwright install chromium

# 配置
cp .env.example .env
# 编辑 .env 填入 LLM_API_KEY

# 运行
echo "写一个显示今日待办事项的网页，支持增删改" > requirements.md
npx tsx src/index.ts --requirements requirements.md
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | DeepSeek API Key |
| `LLM_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `LLM_MODEL` | `deepseek-v4-flash` | 模型名 |
| `WORKSPACE_DIR` | `./workspace` | 工作目录 |

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── orchestrator.ts       # 任务调度
├── agents/
│   ├── base.ts           # Agent 基类（含 KV cache 共享前缀）
│   ├── developer.ts      # 原型构建
│   ├── tester.ts         # 测试生成
│   └── reviewer.ts       # 代码审查
├── llm.ts                # LLM 客户端（含进度日志 + 超时保护）
├── tools.ts              # 文件操作工具
├── logger.ts             # 结构化日志
└── types.ts              # 类型定义
```

## 测试

```bash
npm test          # 项目单元测试
npm run test:run  # 单次运行
```
