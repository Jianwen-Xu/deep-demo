import OpenAI from 'openai';
import { Logger } from './logger.js';
import type { ToolSet } from './tools.js';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface ChatOptions {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoningEffort?: string;
}

const MAX_RETRIES = 3;
const MAX_STEPS = 10;
const STEP_TIMEOUT_MS = 120_000;

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private logger = new Logger();

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.model = config.model;
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: ToolSet,
    options?: ChatOptions
  ): Promise<{ text: string }> {
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    const toolDefs = tools?.definitions;
    const executors = tools?.executors;

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = await this.callAPI(messages, toolDefs, options);
      const message = response.choices[0].message;
      messages.push(message);

      if (!message.tool_calls?.length) {
        this.logger.log('LLM', `Done in ${step} step${step > 1 ? 's' : ''}`);
        return { text: message.content || '' };
      }

      const names = message.tool_calls.map((tc: any) => tc.function.name).join(', ');
      this.logger.log('LLM', `Step ${step}/${MAX_STEPS} → tools: ${names}`);

      for (const toolCall of message.tool_calls) {
        const fn = toolCall.function;
        const exec = executors?.[fn.name];
        if (!exec) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Unknown tool: ${fn.name}` }),
          });
          continue;
        }
        let args: Record<string, any>;
        try {
          args = JSON.parse(fn.arguments);
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Invalid JSON args: ${fn.arguments}` }),
          });
          continue;
        }
        const result = await exec(args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    const last = [...messages].reverse().find(m => m.role === 'assistant');
    this.logger.log('LLM', `Max steps (${MAX_STEPS}) reached, returning last response`);
    return { text: last?.content || '' };
  }

  private async callAPI(messages: any[], tools?: any[], options?: ChatOptions): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const body: Record<string, any> = {
          model: this.model,
          messages,
          tools: tools?.length ? tools : undefined,
          stream: false,
        };

        if (options?.thinking) {
          body.thinking = options.thinking;
          if (options.reasoningEffort) {
            body.reasoning_effort = options.reasoningEffort;
          }
        } else {
          body.thinking = { type: 'disabled' };
        }

        const response = await this.client.chat.completions.create(body as any, {
          timeout: STEP_TIMEOUT_MS,
        });

        if (response.choices.length === 0) {
          throw new Error('API returned 0 choices');
        }
        return response;
      } catch (err: any) {
        lastError = err;
        const msg = err.message || String(err);
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        this.logger.log('LLM', `API call failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${msg}`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }
}
