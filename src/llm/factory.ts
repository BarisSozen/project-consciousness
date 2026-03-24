/**
 * LLM Provider Factory — Config'den doğru provider'ı oluştur
 */

import type { LLMProvider, LLMProviderType } from './types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Config'den LLM provider oluştur.
 *
 * Otomatik tespit: env variable'lara bakarak provider seç
 *   ANTHROPIC_API_KEY → anthropic
 *   OPENAI_API_KEY    → openai
 *   OLLAMA_HOST       → ollama
 *   LLM_PROVIDER      → override
 */
export function createProvider(config?: Partial<LLMConfig>): LLMProvider {
  const provider = config?.provider ?? detectProvider();

  switch (provider) {
    case 'anthropic': {
      const key = config?.apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!key) throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
      return new AnthropicProvider(key, config?.model);
    }

    case 'openai': {
      const key = config?.apiKey ?? process.env['OPENAI_API_KEY'];
      if (!key) throw new Error('OPENAI_API_KEY is required for OpenAI provider');
      return new OpenAIProvider(key, config?.model, config?.baseUrl);
    }

    case 'ollama': {
      const baseUrl = config?.baseUrl ?? process.env['OLLAMA_HOST'];
      return new OllamaProvider(config?.model, baseUrl);
    }

    case 'custom':
      throw new Error('Custom provider requires manual LLMProvider implementation');

    default:
      throw new Error(`Unknown LLM provider: ${provider as string}`);
  }
}

/**
 * Env variable'lardan provider otomatik tespit
 */
function detectProvider(): LLMProviderType {
  // Explicit override
  const explicit = process.env['LLM_PROVIDER'];
  if (explicit) return explicit as LLMProviderType;

  // Auto-detect from available API keys
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic';
  if (process.env['OPENAI_API_KEY']) return 'openai';
  if (process.env['OLLAMA_HOST']) return 'ollama';

  // Default: anthropic (backward compat)
  return 'anthropic';
}
