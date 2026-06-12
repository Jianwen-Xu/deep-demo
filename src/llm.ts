import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class LLMClient {
  private model;

  constructor(config: LLMConfig) {
    const openai = createOpenAICompatible({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = openai(config.model);
  }

  static fromEnv(): LLMClient {
    return new LLMClient({
      apiKey: process.env.LLM_API_KEY || '',
      baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
      model: process.env.LLM_MODEL || 'deepseek-chat',
    });
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, any>
  ): Promise<{ text: string; toolCalls: any[] }> {
    const result = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userMessage,
      tools,
    });
    return { text: result.text, toolCalls: result.toolCalls };
  }
}
