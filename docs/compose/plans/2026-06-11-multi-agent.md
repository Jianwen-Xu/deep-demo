# Multi-Agent Code Development System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-agent collaborative system that takes user requirements and automatically develops code, generates tests, and performs review using TypeScript + Vercel AI SDK.

**Architecture:** Four agents (Orchestrator, Developer, Tester, Reviewer) communicate via shared workspace files. Vercel AI SDK handles LLM calls and tool calling.国产 models accessed through OpenAI-compatible API.

**Tech Stack:** TypeScript, Node.js, Vercel AI SDK (`ai` + `@ai-sdk/openai`), zod, vitest

---

## File Structure

```
src/
├── index.ts              ← CLI entry point
├── orchestrator.ts       ← Task decomposition + agent scheduling
├── agents/
│   ├── base.ts           ← Agent base class
│   ├── developer.ts      ← Code generation agent
│   ├── tester.ts         ← Test generation + execution agent
│   └── reviewer.ts       ← Code review agent
├── llm.ts                ← LLMClient wrapping AI SDK
├── tools.ts              ← Shared tool definitions
└── types.ts              ← Type definitions
tests/
├── llm.test.ts
├── tools.test.ts
├── agents/
│   ├── developer.test.ts
│   ├── tester.test.ts
│   └── reviewer.test.ts
└── orchestrator.test.ts
```

---

### Task 1: Project Setup

**Covers:** [S5]

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`

- [ ] **Step 1: Initialize npm project**

Run: `npm init -y`

- [ ] **Step 2: Install dependencies**

Run: `npm install ai @ai-sdk/openai zod dotenv`
Run: `npm install -D typescript @types/node vitest`

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create .env.example**

```
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
WORKSPACE_DIR=./workspace
```

- [ ] **Step 5: Add scripts to package.json**

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git init
git add package.json tsconfig.json .env.example
git commit -m "chore: project setup with Vercel AI SDK + vitest"
```

---

### Task 2: Type Definitions

**Covers:** [S6]

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`

- [ ] **Step 1: Create types.ts with core interfaces**

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  inputFiles: string[];
  outputFiles: string[];
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
}

export interface AgentConfig {
  name: string;
  workspace: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

export type AgentRole = 'orchestrator' | 'developer' | 'tester' | 'reviewer';
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add core type definitions"
```

---

### Task 3: LLMClient

**Covers:** [S6]

**Files:**
- Create: `src/llm.ts`
- Create: `tests/llm.test.ts`

- [ ] **Step 1: Write test for LLMClient**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '../src/llm.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

describe('LLMClient', () => {
  it('should create instance with config', () => {
    const client = new LLMClient({
      apiKey: 'test-key',
      baseURL: 'https://api.test.com',
      model: 'test-model',
    });
    expect(client).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LLMClient**

```typescript
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { Message } from './types.js';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class LLMClient {
  private model;

  constructor(config: LLMConfig) {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = openai(config.model);
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, any>
  ): Promise<string> {
    const result = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userMessage,
      tools,
    });
    return result.text;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm.ts tests/llm.test.ts
git commit -m "feat: implement LLMClient with Vercel AI SDK"
```

---

### Task 4: Tool System

**Covers:** [S6]

**Files:**
- Create: `src/tools.ts`
- Create: `tests/tools.test.ts`

- [ ] **Step 1: Write tests for file tools**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createFileTools } from '../src/tools.js';

const TEST_DIR = './test-workspace';

beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe('File Tools', () => {
  it('readFile should return file content', async () => {
    const testFile = path.join(TEST_DIR, 'test.txt');
    await fs.writeFile(testFile, 'hello world');
    const tools = createFileTools(TEST_DIR);
    const result = await tools.readFile.execute({ path: 'test.txt' });
    expect(result).toBe('hello world');
  });

  it('writeFile should create file', async () => {
    const tools = createFileTools(TEST_DIR);
    await tools.writeFile.execute({ path: 'output.txt', content: 'test content' });
    const content = await fs.readFile(path.join(TEST_DIR, 'output.txt'), 'utf-8');
    expect(content).toBe('test content');
  });

  it('listFiles should list directory contents', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'a.txt'), 'a');
    await fs.writeFile(path.join(TEST_DIR, 'b.txt'), 'b');
    const tools = createFileTools(TEST_DIR);
    const result = await tools.listFiles.execute({ dir: '.' });
    expect(result).toContain('a.txt');
    expect(result).toContain('b.txt');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement file tools**

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

export function createFileTools(workspace: string) {
  return {
    readFile: tool({
      description: '读取工作空间中的文件内容',
      parameters: z.object({
        path: z.string().describe('相对于工作空间的文件路径'),
      }),
      execute: async ({ path: filePath }) => {
        const fullPath = path.join(workspace, filePath);
        return fs.readFile(fullPath, 'utf-8');
      },
    }),

    writeFile: tool({
      description: '写入内容到工作空间中的文件',
      parameters: z.object({
        path: z.string().describe('相对于工作空间的文件路径'),
        content: z.string().describe('文件内容'),
      }),
      execute: async ({ path: filePath, content }) => {
        const fullPath = path.join(workspace, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return `文件已写入: ${filePath}`;
      },
    }),

    listFiles: tool({
      description: '列出工作空间目录中的文件',
      parameters: z.object({
        dir: z.string().describe('相对于工作空间的目录路径'),
      }),
      execute: async ({ dir }) => {
        const fullPath = path.join(workspace, dir);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
      },
    }),

    executeCommand: tool({
      description: '执行shell命令（如运行测试）',
      parameters: z.object({
        command: z.string().describe('要执行的命令'),
      }),
      execute: async ({ command }) => {
        const { execSync } = await import('child_process');
        try {
          const output = execSync(command, { cwd: workspace, encoding: 'utf-8', timeout: 60000 });
          return output;
        } catch (error: any) {
          return `命令执行失败: ${error.message}\n${error.stderr || ''}`;
        }
      },
    }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: implement file operation tools with AI SDK"
```

---

### Task 5: Agent Base Class

**Covers:** [S6]

**Files:**
- Create: `src/agents/base.ts`

- [ ] **Step 1: Implement Agent base class**

```typescript
import { LLMClient } from '../llm.js';
import { createFileTools } from '../tools.js';
import type { AgentConfig } from '../types.js';
import fs from 'fs/promises';
import path from 'path';

export abstract class Agent {
  protected llm: LLMClient;
  protected workspace: string;
  protected name: string;
  protected tools: Record<string, any>;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.workspace = config.workspace;
    this.llm = new LLMClient(config);
    this.tools = createFileTools(config.workspace);
  }

  abstract getSystemPrompt(): string;

  async run(inputPath: string, outputPath: string): Promise<string> {
    const input = await fs.readFile(path.join(this.workspace, inputPath), 'utf-8');

    const output = await this.llm.chat(
      this.getSystemPrompt(),
      input,
      this.tools
    );

    const outputFull = path.join(this.workspace, outputPath);
    await fs.mkdir(path.dirname(outputFull), { recursive: true });
    await fs.writeFile(outputFull, output, 'utf-8');

    return output;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/base.ts
git commit -m "feat: implement Agent base class with file I/O"
```

---

### Task 6: Developer Agent

**Covers:** [S7]

**Files:**
- Create: `src/agents/developer.ts`
- Create: `tests/agents/developer.test.ts`

- [ ] **Step 1: Write test for Developer Agent**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DeveloperAgent } from '../../src/agents/developer.js';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue('function hello() { return "hello"; }'),
  })),
}));

describe('DeveloperAgent', () => {
  it('should have correct system prompt', () => {
    const agent = new DeveloperAgent({
      name: 'developer',
      workspace: './test',
      apiKey: 'test',
      baseURL: 'https://test.com',
      model: 'test',
    });
    const prompt = agent.getSystemPrompt();
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('代码');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/developer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Developer Agent**

```typescript
import { Agent } from './base.js';

export class DeveloperAgent extends Agent {
  getSystemPrompt(): string {
    return `你是一个专业的 TypeScript 开发者。

你的任务是根据任务描述生成高质量的 TypeScript 代码。

要求：
1. 生成完整、可运行的 TypeScript 代码
2. 遵循最佳实践和设计模式
3. 代码要简洁、清晰、易于维护
4. 使用类型注解确保类型安全
5. 输出完整的文件内容，包含必要的 import 语句

使用 writeFile 工具将代码写入指定的输出路径。`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/developer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/developer.ts tests/agents/developer.test.ts
git commit -m "feat: implement Developer Agent"
```

---

### Task 7: Tester Agent

**Covers:** [S7]

**Files:**
- Create: `src/agents/tester.ts`
- Create: `tests/agents/tester.test.ts`

- [ ] **Step 1: Write test for Tester Agent**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TesterAgent } from '../../src/agents/tester.js';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue('describe("test", () => { it("works", () => {}); });'),
  })),
}));

describe('TesterAgent', () => {
  it('should have correct system prompt', () => {
    const agent = new TesterAgent({
      name: 'tester',
      workspace: './test',
      apiKey: 'test',
      baseURL: 'https://test.com',
      model: 'test',
    });
    const prompt = agent.getSystemPrompt();
    expect(prompt).toContain('vitest');
    expect(prompt).toContain('测试');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/tester.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Tester Agent**

```typescript
import { Agent } from './base.js';

export class TesterAgent extends Agent {
  getSystemPrompt(): string {
    return `你是一个专业的测试工程师。

你的任务是为给定的 TypeScript 代码生成全面的单元测试。

要求：
1. 使用 vitest 测试框架
2. 覆盖正常路径、边界情况和错误情况
3. 测试文件命名与源文件对应（如 foo.ts → foo.test.ts）
4. 使用 describe/it 组织测试结构
5. 测试要清晰、可读、独立

使用 writeFile 工具将测试代码写入 tests/ 目录。
使用 executeCommand 工具运行测试并报告结果。`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/tester.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/tester.ts tests/agents/tester.test.ts
git commit -m "feat: implement Tester Agent"
```

---

### Task 8: Reviewer Agent

**Covers:** [S7]

**Files:**
- Create: `src/agents/reviewer.ts`
- Create: `tests/agents/reviewer.test.ts`

- [ ] **Step 1: Write test for Reviewer Agent**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReviewerAgent } from '../../src/agents/reviewer.js';

vi.mock('../../src/llm.js', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue('## Review\n\n代码质量良好，建议添加错误处理。\n\n**结论：通过**'),
  })),
}));

describe('ReviewerAgent', () => {
  it('should have correct system prompt', () => {
    const agent = new ReviewerAgent({
      name: 'reviewer',
      workspace: './test',
      apiKey: 'test',
      baseURL: 'https://test.com',
      model: 'test',
    });
    const prompt = agent.getSystemPrompt();
    expect(prompt).toContain('Review');
    expect(prompt).toContain('代码质量');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/reviewer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Reviewer Agent**

```typescript
import { Agent } from './base.js';

export class ReviewerAgent extends Agent {
  getSystemPrompt(): string {
    return `你是一个资深的代码审查专家。

你的任务是审查代码和测试的质量，并提供详细的反馈。

审查维度：
1. 代码质量和可读性
2. 类型安全性和 TypeScript 最佳实践
3. 测试覆盖率和测试质量
4. 潜在的bug和边界情况
5. 性能和安全性考虑

输出格式：
## Review 摘要
[总体评价]

## 问题列表
- [严重程度] 问题描述

## 建议
- 改进建议

## 结论
通过 / 需修改 [原因]`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agents/reviewer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/reviewer.ts tests/agents/reviewer.test.ts
git commit -m "feat: implement Reviewer Agent"
```

---

### Task 9: Orchestrator

**Covers:** [S3, S7]

**Files:**
- Create: `src/orchestrator.ts`
- Create: `tests/orchestrator.test.ts`

- [ ] **Step 1: Write test for Orchestrator**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Orchestrator } from '../src/orchestrator.js';

const TEST_DIR = './test-workspace-orch';

beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe('Orchestrator', () => {
  it('should create workspace directories', async () => {
    const orch = new Orchestrator({
      workspace: TEST_DIR,
      apiKey: 'test',
      baseURL: 'https://test.com',
      model: 'test',
    });
    await orch.init();
    const dirs = await fs.readdir(TEST_DIR);
    expect(dirs).toContain('tasks');
    expect(dirs).toContain('src');
    expect(dirs).toContain('tests');
    expect(dirs).toContain('reviews');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Orchestrator**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { DeveloperAgent } from './agents/developer.js';
import { TesterAgent } from './agents/tester.js';
import { ReviewerAgent } from './agents/reviewer.js';
import type { AgentConfig, Task } from './types.js';

export class Orchestrator {
  private workspace: string;
  private config: AgentConfig;
  private developer: DeveloperAgent;
  private tester: TesterAgent;
  private reviewer: ReviewerAgent;
  private maxRetries = 3;

  constructor(config: Omit<AgentConfig, 'name'>) {
    this.workspace = config.workspace;
    this.config = { ...config, name: 'orchestrator' };
    this.developer = new DeveloperAgent(config);
    this.tester = new TesterAgent(config);
    this.reviewer = new ReviewerAgent(config);
  }

  async init(): Promise<void> {
    const dirs = ['tasks', 'src', 'tests', 'reviews'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.workspace, dir), { recursive: true });
    }
  }

  async run(requirementsPath: string): Promise<void> {
    await this.init();

    // Step 1: Write requirements to workspace
    const requirements = await fs.readFile(requirementsPath, 'utf-8');
    await fs.writeFile(path.join(this.workspace, 'requirements.md'), requirements);

    // Step 2: Developer generates code
    console.log('[Orchestrator] 开发者开始编码...');
    await this.developer.run('requirements.md', 'src/index.ts');

    // Step 3: Tester generates and runs tests
    console.log('[Orchestrator] 测试工程师开始测试...');
    await this.tester.run('src/index.ts', 'tests/index.test.ts');

    // Step 4: Reviewer reviews
    console.log('[Orchestrator] 审查专家开始审查...');
    const review = await this.reviewer.run(
      'src/index.ts',
      'reviews/review.md'
    );

    // Step 5: Check if review passed
    if (review.includes('需修改') && this.maxRetries > 0) {
      console.log('[Orchestrator] Review 未通过，重新修改...');
      this.maxRetries--;
      await this.run(requirementsPath);
    }

    console.log('[Orchestrator] 完成！');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: implement Orchestrator with agent scheduling"
```

---

### Task 10: CLI Entry Point

**Covers:** [S3]

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement CLI entry point**

```typescript
import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const requirementsIdx = args.indexOf('--requirements');
  const requirementsFile = requirementsIdx !== -1 ? args[requirementsIdx + 1] : null;

  if (!requirementsFile) {
    console.error('用法: tsx src/index.ts --requirements <需求文件路径>');
    process.exit(1);
  }

  const config = {
    workspace: process.env.WORKSPACE_DIR || './workspace',
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
  };

  if (!config.apiKey) {
    console.error('请设置 LLM_API_KEY 环境变量');
    process.exit(1);
  }

  const orch = new Orchestrator(config);
  console.log('多Agent协作开发系统启动...');
  console.log(`需求文件: ${requirementsFile}`);
  console.log(`工作目录: ${config.workspace}`);

  await orch.run(path.resolve(requirementsFile));

  console.log('完成！请查看工作目录中的输出。');
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point"
```

---

### Task 11: Run Full Test Suite

**Covers:** [S9]

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: verify full test suite and type checking"
```
