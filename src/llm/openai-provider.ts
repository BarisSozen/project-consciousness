/**
 * OpenAI Provider — GPT / o-series API Adapter
 *
 * OpenAI chat completions API'yi LLMProvider interface'ine sarar.
 * Dependency: openai paketi (opsiyonel peer dep).
 */

import type { LLMProvider, LLMMessage, LLMResponse, LLMChatOptions } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.defaultModel = model ?? DEFAULT_MODEL;
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    const maxTokens = options?.maxTokens ?? 4096;

    const body = {
      model,
      max_tokens: maxTokens,
      ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorBody.slice(0, 500)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    const choice = data.choices[0];

    return {
      text: choice?.message.content ?? '',
      tokensUsed: data.usage?.total_tokens,
      model: data.model,
      finishReason: choice?.finish_reason,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      if (response.ok) {
        return { ok: true, detail: `OpenAI OK (base: ${this.baseUrl})` };
      }
      return { ok: false, detail: `OpenAI HTTP ${response.status}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, detail: `OpenAI error: ${msg}` };
    }
  }
}
