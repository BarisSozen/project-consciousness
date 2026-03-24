/**
 * Semantic Analyzer — LLM ile Wiring Mantık Kontrolü
 *
 * LLMProvider abstraction ile herhangi bir model kullanabilir.
 */

import type { LLMProvider } from '../../llm/types.js';
import type {
  DependencyEdge,
  ExportNode,
  WiringIssue,
  SemanticInsight,
} from '../../types/index.js';

const SEMANTIC_SYSTEM_PROMPT = `You are an experienced software architect. Your task is to identify wiring issues in a TypeScript project.

You will receive:
1. Import/export graph — which file imports what
2. File summaries — what each file does
3. Architecture decisions — how the project is structured

Detect:
- **injection-missing**: A service/handler needs another service but it's not injected
- **config-mismatch**: Env variable or config value used but undefined or type mismatch
- **interface-drift**: Contract mismatch between two modules (parameter types, return types)
- **handler-gap**: Route defined but handler not connected, or missing link in middleware chain
- **data-flow-break**: Data should flow A→B→C but B→C connection is broken

OUTPUT: JSON array only, each element:
{
  "category": "injection-missing|config-mismatch|interface-drift|handler-gap|data-flow-break",
  "description": "Human-readable description",
  "files": ["file1.ts", "file2.ts"],
  "confidence": 0.0-1.0
}

Mark uncertain findings with low confidence. Stay silent rather than produce false positives.`;

export class SemanticAnalyzer {
  private provider: LLMProvider | null;

  constructor(provider?: LLMProvider | null) {
    this.provider = provider ?? null;
  }

  /**
   * Import graph + dosya özetlerini LLM'e gönder, semantic sorunları tespit et
   */
  async analyze(
    edges: DependencyEdge[],
    exports: ExportNode[],
    fileSummaries: Map<string, string>,
    architecture?: string
  ): Promise<SemanticInsight[]> {
    if (!this.provider) {
      return []; // No LLM provider, skip
    }

    const prompt = this.buildPrompt(edges, exports, fileSummaries, architecture);

    try {
      const response = await this.provider.chat(
        [{ role: 'user', content: prompt }],
        { system: SEMANTIC_SYSTEM_PROMPT, maxTokens: 4096 }
      );

      return this.parseResponse(response.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️ Semantic analysis failed: ${msg}`);
      return [];
    }
  }

  /**
   * Semantic insight'ları WiringIssue'lara dönüştür
   */
  toWiringIssues(insights: SemanticInsight[]): WiringIssue[] {
    return insights
      .filter(i => i.confidence >= 0.5) // düşük güvenli olanları filtrele
      .map(insight => ({
        type: this.mapCategory(insight.category),
        severity: insight.confidence >= 0.8 ? 'warning' as const : 'info' as const,
        file: insight.files[0] ?? 'unknown',
        detail: `[LLM %.0f%%] ${insight.description}`.replace('%.0f', String(Math.round(insight.confidence * 100))),
        suggestion: this.generateSuggestion(insight),
      }));
  }

  // ── Private ────────────────────────────────────────────────

  private buildPrompt(
    edges: DependencyEdge[],
    exports: ExportNode[],
    fileSummaries: Map<string, string>,
    architecture?: string
  ): string {
    const parts: string[] = [];

    // Graph özeti
    parts.push('## Import/Export Grafiği\n');
    for (const edge of edges.slice(0, 100)) { // max 100 edge
      parts.push(`${edge.source} → ${edge.target} [${edge.symbols.join(', ')}]`);
    }

    // Export listesi
    parts.push('\n## Dosya Export\'ları\n');
    const byFile = new Map<string, ExportNode[]>();
    for (const exp of exports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }
    for (const [file, exps] of byFile) {
      parts.push(`**${file}**: ${exps.map(e => `${e.symbol}(${e.kind})`).join(', ')}`);
    }

    // Dosya özetleri
    parts.push('\n## Dosya İçerik Özetleri\n');
    for (const [file, summary] of fileSummaries) {
      parts.push(`### ${file}\n${summary.slice(0, 500)}\n`);
    }

    // Mimari
    if (architecture) {
      parts.push(`\n## Mimari Kararlar\n${architecture.slice(0, 1500)}\n`);
    }

    parts.push('\n---\nBu projedeki wiring sorunlarını JSON array olarak raporla.');

    return parts.join('\n');
  }

  private parseResponse(text: string): SemanticInsight[] {
    // JSON array çıkar
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]) as SemanticInsight[];
      return parsed.filter(item =>
        item.category && item.description && Array.isArray(item.files) &&
        typeof item.confidence === 'number'
      );
    } catch {
      return [];
    }
  }

  private mapCategory(category: SemanticInsight['category']): WiringIssue['type'] {
    const map: Record<SemanticInsight['category'], WiringIssue['type']> = {
      'injection-missing': 'missing-import',
      'config-mismatch': 'type-mismatch',
      'interface-drift': 'type-mismatch',
      'handler-gap': 'missing-import',
      'data-flow-break': 'runtime-gap',
    };
    return map[category];
  }

  private generateSuggestion(insight: SemanticInsight): string {
    const map: Record<SemanticInsight['category'], string> = {
      'injection-missing': 'Inject the missing service via constructor or factory',
      'config-mismatch': 'Check config/env values, compare with .env.example',
      'interface-drift': 'Define a shared interface and ensure both sides implement it',
      'handler-gap': 'Check route definition and handler binding, verify middleware chain',
      'data-flow-break': 'Find the broken point in data flow, add missing intermediate layer',
    };
    return map[insight.category];
  }
}
