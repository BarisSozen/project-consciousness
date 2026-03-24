/**
 * Config → LLMProvider resolver
 * 
 * OrchestratorConfig'den doğru LLMProvider'ı oluşturur.
 * Backward compat: claudeApiKey varsa anthropic provider olur.
 */

import type { LLMProvider } from '../llm/types.js';
import { createProvider } from '../llm/factory.js';
import type { OrchestratorConfig } from '../types/index.js';

export function resolveProvider(config: OrchestratorConfig): LLMProvider | null {
  const apiKey = config.llmApiKey ?? config.claudeApiKey;
  const model = config.llmModel ?? config.model;
  const provider = config.llmProvider ?? (config.claudeApiKey ? 'anthropic' : undefined);

  if (!provider && !apiKey) return null;

  return createProvider({
    provider: provider ?? 'anthropic',
    apiKey: apiKey,
    model,
    baseUrl: config.llmBaseUrl,
  });
}
