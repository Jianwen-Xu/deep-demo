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

  await orch.init();
  await orch.run(path.resolve(requirementsFile));

  console.log('完成！请查看工作目录中的输出。');
}

main().catch(console.error);
