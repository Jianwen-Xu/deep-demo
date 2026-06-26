import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '../src/llm.js';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    this.chat = { completions: { create: vi.fn() } };
  }),
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
