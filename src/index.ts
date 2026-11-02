import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';
import path from 'path';

const DEFAULT_WORKSPACE = path.resolve('./workspace');

async function main() {
  const args = process.argv.slice(2);
  const requirementsIdx = args.indexOf('--requirements');
  const requirementsFile = requirementsIdx !== -1 ? args[requirementsIdx + 1] : null;
  const verbose = args.includes('--verbose');

  if (!requirementsFile) {
    console.error('用法: tsx src/index.ts --requirements <需求文件路径> [--verbose]');
    process.exit(1);
  }

  const config = {
    workspace: process.env.WORKSPACE_DIR || DEFAULT_WORKSPACE,
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-v4-flash',
    verbose,
  };

  if (!config.apiKey) {
    console.error('请设置 LLM_API_KEY 环境变量');
    process.exit(1);
  }

  const orch = new Orchestrator(config);
  console.log('');
  console.log('  ⚛  Deep-Demo 多 Agent 协作开发系统');
  console.log(`  📄  需求: ${path.basename(requirementsFile)}`);
  console.log(`  📁  工作目录: ${config.workspace}`);
  console.log(`  🤖  模型: ${config.model}${verbose ? ' (详细模式)' : ''}`);
  console.log('');

  await orch.init();
  const outcome = await orch.run(path.resolve(requirementsFile));

  console.log('');
  if (outcome === 'done') {
    console.log('  ✅ 完成！请查看工作目录中的输出。');
    process.exitCode = 0;
  } else if (outcome === 'blocked') {
    const state = orch.getState();
    const last = state.changes[state.changes.length - 1];
    console.log('  ⏸  已暂停：需要人工回答一个问题。');
    console.log(`     ${last?.reason ?? ''}`);
    console.log('     详情见工作目录下的 needs-human.md；回答后重新运行即可。');
    process.exitCode = 2;
  } else {
    console.log('  ❌ 未完成：达到最大重试次数。请查看 reviews/ 与 reports/ 后重跑。');
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
