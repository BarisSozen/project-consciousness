/**
 * Semantic Analyzer — LLM ile Wiring Mantık Kontrolü
 *
 * Static analiz grafiğini ve dosya içeriklerini Claude'a göndererek:
 * - Service injection eksiklikleri
 * - Config/env wiring hataları
 * - Interface contract uyumsuzlukları
 * - Data flow kırıklıkları
 * tespit eder.
 *
 * Static analyzer "X, Y'yi import etmiyor" der.
 * Semantic analyzer "X, Y'yi import ETMELİ çünkü Z fonksiyonuna ihtiyacı var" der.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  DependencyEdge,
  ExportNode,
  WiringIssue,
  SemanticInsight,
} from '../../types/index.js';

const SEMANTIC_SYSTEM_PROMPT = `Sen deneyimli bir yazılım mimarısın. Görevin bir TypeScript projesinin bağlantı (wiring) sorunlarını tespit etmek.

Sana verilecek:
1. Import/export grafiği — hangi dosya kimi import ediyor
2. Dosya özetleri — her dosyanın ne yaptığı
3. Mimari kararlar — proje nasıl yapılandırılmış

Şunları tespit et:
- **injection-missing**: Bir service/handler başka bir service'e ihtiyaç duyuyor ama inject edilmemiş
- **config-mismatch**: Env variable veya config değeri kullanılıyor ama tanımlı değil veya tip uyumsuz
- **interface-drift**: İki modül arasındaki kontrat (parametre tipleri, return tipleri) uyumsuz
- **handler-gap**: Route tanımlı ama handler bağlı değil, veya middleware zincirinde eksik halka
- **data-flow-break**: Veri A→B→C akmalı ama B→C bağlantısı kopuk

ÇIKTI: Sadece JSON array, her eleman:
{
  "category": "injection-missing|config-mismatch|interface-drift|handler-gap|data-flow-break",
  "description": "İnsan-okunabilir açıklama",
  "files": ["dosya1.ts", "dosya2.ts"],
  "confidence": 0.0-1.0
}

Emin olmadığın şeyleri düşük confidence ile belirt. Yanlış pozitif vermektense sessiz kal.`;

export class SemanticAnalyzer {
  private client: Anthropic | null;
  private model: string;

  constructor(apiKey?: string, model = 'claude-sonnet-4-20250514') {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = model;
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
    if (!this.client) {
      return []; // API key yoksa atla
    }

    const prompt = this.buildPrompt(edges, exports, fileSummaries, architecture);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SEMANTIC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');

      return this.parseResponse(text);
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
    switch (category) {
      case 'injection-missing': return 'missing-import';
      case 'config-mismatch': return 'type-mismatch';
      case 'interface-drift': return 'type-mismatch';
      case 'handler-gap': return 'missing-import';
      case 'data-flow-break': return 'runtime-gap';
    }
  }

  private generateSuggestion(insight: SemanticInsight): string {
    switch (insight.category) {
      case 'injection-missing':
        return `Eksik service'i constructor veya factory üzerinden inject et`;
      case 'config-mismatch':
        return `Config/env değerlerini kontrol et, .env.example ile karşılaştır`;
      case 'interface-drift':
        return `Ortak bir interface tanımla ve her iki tarafın da bunu implemente ettiğinden emin ol`;
      case 'handler-gap':
        return `Route tanımını ve handler bağlantısını kontrol et, middleware zincirini doğrula`;
      case 'data-flow-break':
        return `Veri akışındaki kırık noktayı bul, ara katman eksikse ekle`;
    }
  }
}
