/**
 * LLM Provider — Model-Agnostic Chat Interface
 *
 * Anthropic, OpenAI, Ollama ve diğer LLM provider'ları
 * tek bir interface arkasında soyutlar.
 *
 * Orchestrator/Evaluator/Planner artık doğrudan Anthropic SDK'ya
 * bağlı değil — bu interface üzerinden konuşur.
 */

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  text: string;
  tokensUsed?: number;
  model?: string;
  finishReason?: string;
}

export interface LLMChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  temperature?: number;
}

/**
 * Tüm LLM provider'ların implemente etmesi gereken interface.
 */
export interface LLMProvider {
  /** Provider adı: 'anthropic' | 'openai' | 'ollama' | ... */
  readonly name: string;

  /**
   * Chat completion — mesaj listesine yanıt üret
   */
  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse>;

  /**
   * Provider erişilebilir mi? (API key geçerli mi, server ayakta mı)
   */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export type LLMProviderType = 'anthropic' | 'openai' | 'ollama' | 'custom';
