import OpenAI from 'openai';
import { Logger } from './logger.js';
import type { ToolSet, ToolDefinition } from './tools.js';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionTool,
  ChatCompletion,
} from 'openai/resources/chat/completions';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface ChatOptions {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoningEffort?: string;
  agentName?: string;
  verbose?: boolean;
}

const MAX_RETRIES = 3;
const MAX_STEPS = 10;
const STEP_TIMEOUT_MS = 120_000;

function messageContent(msg: ChatCompletionMessageParam): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map(p => 'text' in p ? p.text : '').join('');
  }
  return '';
}

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
    const name = options?.agentName || 'LLM';
    const verbose = options?.verbose || false;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    const toolDefs = tools?.definitions?.map(toChatCompletionTool);
    const executors = tools?.executors;
    const stepStart = Date.now();

    for (let step = 1; step <= MAX_STEPS; step++) {
      const apiStart = Date.now();
      const response = await this.callAPI(messages, toolDefs, options);
      const apiElapsed = Date.now() - apiStart;
      const message = response.choices[0].message;
      messages.push(message);

      if (!message.tool_calls?.length) {
        const totalElapsed = Date.now() - stepStart;
        this.logger.sub(name, `Done in ${step} step${step > 1 ? 's' : ''} (${totalElapsed}ms)`);
        return { text: messageContent(message) };
      }

      const toolCalls = message.tool_calls as unknown as ChatCompletionMessageFunctionToolCall[];
      const names = toolCalls.map(tc => tc.function.name).join(', ');
      this.logger.sub(name, `Step ${step}/${MAX_STEPS} (${apiElapsed}ms) → ${toolCalls.length} ${names}`);

      if (verbose) {
        for (const tc of toolCalls) {
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const summary = Object.entries(args)
              .map(([k, v]) => {
                const s = String(v);
                return `${k}=${s.length > 60 ? s.slice(0, 60) + '...' : s}`;
              })
              .join(', ');
            this.logger.detail(name, `${tc.function.name}(${summary})`);
          } catch {
            this.logger.detail(name, `${tc.function.name}(...)`);
          }
        }
      }

      for (const toolCall of toolCalls) {
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
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Invalid JSON args: ${fn.arguments}` }),
          });
          continue;
        }
        const execStart = Date.now();
        const result = await exec(args);
        const execElapsed = Date.now() - execStart;
        if (verbose) {
          this.logger.detail(name, `↳ ${fn.name} done (${execElapsed}ms)`);
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    const last = [...messages].reverse().find(m => m.role === 'assistant');
    this.logger.sub(name, `Max steps (${MAX_STEPS}) reached, returning last response`);
    return { text: last ? messageContent(last) : '' };
  }

  private async callAPI(
    messages: ChatCompletionMessageParam[],
    tools?: ChatCompletionTool[],
    options?: ChatOptions
  ): Promise<ChatCompletion> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const body: Record<string, unknown> = {
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
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        this.logger.sub(options?.agentName || 'LLM', `API call failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms: ${msg}`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }
}

function toChatCompletionTool(def: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: def.function.name,
      description: def.function.description,
      parameters: def.function.parameters as Record<string, unknown>,
    },
  };
}
