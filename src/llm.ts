import { generateText, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Logger } from './logger.js';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

const MAX_RETRIES = 3;
const MAX_STEPS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class LLMClient {
  private model;
  private logger = new Logger();

  constructor(config: LLMConfig) {
    const openai = createOpenAICompatible({
      name: 'openai-compatible',
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = openai(config.model);
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, any>
  ): Promise<{ text: string; toolCalls: any[] }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await generateText({
          model: this.model,
          system: systemPrompt,
          prompt: userMessage,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
        });

        return { text: result.text, toolCalls: result.toolCalls };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(String(err));
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        this.logger.log('LLM', `API call failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${message}`);
        if (attempt < MAX_RETRIES - 1) {
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }
}
