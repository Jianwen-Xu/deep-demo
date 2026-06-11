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
