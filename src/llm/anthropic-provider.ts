/**
 * Anthropic Provider — Claude API Adapter
 *
 * @anthropic-ai/sdk'yı LLMProvider interface'ine sarar.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMResponse, LLMChatOptions } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = model ?? DEFAULT_MODEL;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const systemPrompt = options?.system
      ?? messages.find(m => m.role === 'system')?.content;

    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await this.client.messages.create({
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      messages: chatMessages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    return {
      text,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      model: response.model,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true, detail: `Anthropic OK (model: ${response.model})` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, detail: `Anthropic error: ${msg}` };
    }
  }
}
