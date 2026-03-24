/**
 * Ollama Provider — Local LLM Adapter
 *
 * Ollama REST API'yi LLMProvider interface'ine sarar.
 * Dependency yok — sadece fetch kullanır.
 * Default: http://localhost:11434
 */

import type { LLMProvider, LLMMessage, LLMResponse, LLMChatOptions } from './types.js';

const DEFAULT_MODEL = 'llama3';
const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private defaultModel: string;
  private baseUrl: string;

  constructor(model?: string, baseUrl?: string) {
    this.defaultModel = model ?? DEFAULT_MODEL;
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    const body = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        ...(options?.temperature != null ? { temperature: options.temperature } : {}),
        ...(options?.maxTokens ? { num_predict: options.maxTokens } : {}),
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorBody.slice(0, 500)}`);
    }

    const data = await response.json() as {
      message: { role: string; content: string };
      model: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      text: data.message.content,
      tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
      model: data.model,
      finishReason: 'stop',
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models?.map(m => m.name).join(', ') ?? 'unknown';
        return { ok: true, detail: `Ollama OK (models: ${models})` };
      }
      return { ok: false, detail: `Ollama HTTP ${response.status}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, detail: `Ollama error: ${msg}` };
    }
  }
}
