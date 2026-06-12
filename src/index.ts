import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';
import path from 'path';

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
    workspace: process.env.WORKSPACE_DIR || './workspace',
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
  await orch.run(path.resolve(requirementsFile));

  console.log('');
  console.log('  ✅ 完成！请查看工作目录中的输出。');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
