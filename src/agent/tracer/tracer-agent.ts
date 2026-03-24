/**
 * Tracer Agent — Data Flow Takip + Wiring Problem Çözücü
 *
 * Projede "gezinen" bir agent: dosyalar arası bağlantıları takip eder,
 * veri akışını izler, kırık noktaları bulur.
 *
 * 3 katmanlı analiz:
 * 1. Static — import/export grafı, dead exports, circular deps, phantom deps
 * 2. Semantic — LLM ile mantıksal wiring kontrolü (inject eksik mi? config doğru mu?)
 * 3. Runtime — server başlat, HTTP probe, handler zinciri izle, data flow trace
 *
 * Tasarım ilkesi: Invasive değil. Projeyi bozmaz, geçici dosyaları temizler.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StaticAnalyzer } from './static-analyzer.js';
import { SemanticAnalyzer } from './semantic-analyzer.js';
import { RuntimeTracer } from './runtime-tracer.js';
import type {
  TracerReport,
  WiringIssue,
  SemanticInsight,
  ExportNode,
  DependencyEdge,
} from '../../types/index.js';

export interface TracerConfig {
  projectRoot: string;
  /** LLM provider instance (semantic analysis) */
  llmProvider?: import('../../llm/types.js').LLMProvider | null;
  /** @deprecated Use llmProvider instead */
  apiKey?: string;
  /** @deprecated Use llmProvider instead */
  model?: string;
  /** Server port for runtime tracing (default: 3000) */
  port?: number;
  /** Layers — which ones should run */
  layers?: {
    static?: boolean;    // default: true
    semantic?: boolean;  // default: true (if provider available)
    runtime?: boolean;   // default: true
  };
  /** Log function */
  log?: (message: string) => void;
}

export class TracerAgent {
  private staticAnalyzer: StaticAnalyzer;
  private semanticAnalyzer: SemanticAnalyzer;
  private runtimeTracer: RuntimeTracer;
  private config: TracerConfig;
  private log: (message: string) => void;

  constructor(config: TracerConfig) {
    this.config = config;
    this.staticAnalyzer = new StaticAnalyzer(config.projectRoot);
    this.semanticAnalyzer = new SemanticAnalyzer(config.llmProvider ?? null);
    this.runtimeTracer = new RuntimeTracer(config.projectRoot, config.port ?? 3000);
    this.log = config.log ?? console.log;
  }

  // ── Ana Giriş Noktası ─────────────────────────────────────

  /**
   * Tam analiz: static → semantic → runtime
   * Her katman bir öncekinin çıktısını zenginleştirir.
   */
  async run(): Promise<TracerReport> {
    this.log('🔍 Tracer Agent başlatılıyor...');
    const startTime = Date.now();

    const layers = {
      static: this.config.layers?.static !== false,
      semantic: this.config.layers?.semantic !== false && !!this.config.llmProvider,
      runtime: this.config.layers?.runtime !== false,
    };

    // ── Katman 1: Static Analysis ──────────────────────────
    let graph = { nodes: [] as ExportNode[], edges: [] as DependencyEdge[], entryPoints: [] as string[] };
    let staticIssues: WiringIssue[] = [];

    if (layers.static) {
      this.log('\n━━━ Katman 1: Static Analysis ━━━');
      const { exports, edges, files } = await this.staticAnalyzer.buildGraph();

      graph = {
        nodes: exports,
        edges,
        entryPoints: files.filter(f => /^(src\/)?index\.ts$/.test(f) || f.includes('bin/')),
      };

      this.log(`  📊 ${files.length} dosya, ${exports.length} export, ${edges.length} bağlantı`);

      staticIssues = await this.staticAnalyzer.findIssues();
      this.log(`  🔎 ${staticIssues.length} sorun tespit edildi`);

      for (const issue of staticIssues.filter(i => i.severity === 'critical')) {
        this.log(`  🚨 [${issue.type}] ${issue.detail}`);
      }
    }

    // ── Katman 2: Semantic Analysis ────────────────────────
    let semanticInsights: SemanticInsight[] = [];
    let semanticIssues: WiringIssue[] = [];

    if (layers.semantic) {
      this.log('\n━━━ Katman 2: Semantic Analysis (LLM) ━━━');

      // Dosya özetleri hazırla
      const fileSummaries = await this.buildFileSummaries(graph.nodes);

      // Mimari bilgisini oku
      let architecture: string | undefined;
      try {
        architecture = await readFile(join(this.config.projectRoot, 'ARCHITECTURE.md'), 'utf-8');
      } catch { /* yok, sorun değil */ }

      semanticInsights = await this.semanticAnalyzer.analyze(
        graph.edges,
        graph.nodes,
        fileSummaries,
        architecture
      );

      semanticIssues = this.semanticAnalyzer.toWiringIssues(semanticInsights);
      this.log(`  🧠 ${semanticInsights.length} semantic insight, ${semanticIssues.length} sorun`);

      for (const insight of semanticInsights.filter(i => i.confidence >= 0.7)) {
        this.log(`  💡 [${insight.category}] ${insight.description}`);
      }
    }

    // ── Katman 3: Runtime Tracing ──────────────────────────
    let runtimeTraces: TracerReport['runtimeTraces'] = [];
    let runtimeIssues: WiringIssue[] = [];

    if (layers.runtime) {
      this.log('\n━━━ Katman 3: Runtime Tracing ━━━');
      const runtimeResult = await this.runtimeTracer.trace();

      runtimeTraces = runtimeResult.traces;
      runtimeIssues = runtimeResult.issues;

      this.log(`  🌐 ${runtimeTraces.length} endpoint trace edildi`);
      this.log(`  ⚡ ${runtimeIssues.length} runtime sorun tespit edildi`);

      for (const trace of runtimeTraces) {
        const status = trace.httpEvent.status;
        const icon = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
        this.log(`  ${icon} ${trace.httpEvent.method} ${trace.httpEvent.path} → ${status} (${trace.httpEvent.duration}ms, ${trace.dataFlow.length} flow adımı)`);
      }
    }

    // ── Birleştir ──────────────────────────────────────────
    const allIssues = this.deduplicateIssues([
      ...staticIssues,
      ...semanticIssues,
      ...runtimeIssues,
    ]);

    const report: TracerReport = {
      graph,
      staticIssues,
      semanticInsights,
      runtimeTraces,
      allIssues,
      summary: {
        totalFiles: graph.nodes.length > 0
          ? new Set(graph.nodes.map(n => n.file)).size
          : 0,
        totalEdges: graph.edges.length,
        totalIssues: allIssues.length,
        criticalCount: allIssues.filter(i => i.severity === 'critical').length,
        warningCount: allIssues.filter(i => i.severity === 'warning').length,
        coveragePercent: this.calculateCoverage(graph, runtimeTraces),
      },
      timestamp: new Date().toISOString(),
    };

    // ── Özet ───────────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    this.log('\n═══════════════════════════════════════════════');
    this.log('📋 TRACER RAPORU');
    this.log('═══════════════════════════════════════════════');
    this.log(`  📁 Dosya: ${report.summary.totalFiles}`);
    this.log(`  🔗 Bağlantı: ${report.summary.totalEdges}`);
    this.log(`  🚨 Critical: ${report.summary.criticalCount}`);
    this.log(`  ⚠️  Warning: ${report.summary.warningCount}`);
    this.log(`  ℹ️  Info: ${allIssues.filter(i => i.severity === 'info').length}`);
    this.log(`  📊 Kapsam: %${report.summary.coveragePercent.toFixed(0)}`);
    this.log(`  ⏱️  Süre: ${elapsed}ms`);
    this.log('═══════════════════════════════════════════════');

    return report;
  }

  // ── Yardımcılar ────────────────────────────────────────────

  /**
   * Her dosya için kısa özet oluştur (LLM'e göndermek için)
   */
  private async buildFileSummaries(exports: ExportNode[]): Promise<Map<string, string>> {
    const summaries = new Map<string, string>();
    const uniqueFiles = [...new Set(exports.map(e => e.file))];

    for (const file of uniqueFiles.slice(0, 30)) { // max 30 dosya
      try {
        const content = await readFile(join(this.config.projectRoot, file), 'utf-8');
        const lines = content.split('\n');

        // İlk yorum bloğu + export listesi
        const firstComment = lines
          .filter(l => l.trimStart().startsWith('*') || l.trimStart().startsWith('//'))
          .slice(0, 5)
          .join('\n');

        const fileExports = exports
          .filter(e => e.file === file)
          .map(e => `${e.symbol}(${e.kind})`)
          .join(', ');

        summaries.set(file, `${firstComment}\nExports: ${fileExports}\nLines: ${lines.length}`);
      } catch {
        summaries.set(file, '[okunamadı]');
      }
    }

    return summaries;
  }

  /**
   * Aynı sorunu farklı katmanlarda tespit ettiğimizde deduplicate et
   */
  private deduplicateIssues(issues: WiringIssue[]): WiringIssue[] {
    const seen = new Set<string>();
    const unique: WiringIssue[] = [];

    for (const issue of issues) {
      // Basit key: type + file + ilk 80 karakter detail
      const key = `${issue.type}:${issue.file}:${issue.detail.slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }

    // Severity'ye göre sırala: critical → warning → info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    unique.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return unique;
  }

  /**
   * Runtime trace'lerin proje dosyalarını ne kadar kapsadığını hesapla
   */
  private calculateCoverage(
    graph: TracerReport['graph'],
    traces: TracerReport['runtimeTraces']
  ): number {
    if (graph.nodes.length === 0) return 0;

    const allFiles = new Set(graph.nodes.map(n => n.file));
    const tracedFiles = new Set<string>();

    for (const trace of traces) {
      for (const step of trace.dataFlow) {
        tracedFiles.add(step.file);
      }
    }

    // Traced + statically analyzed dosyalar
    const covered = [...allFiles].filter(f => tracedFiles.has(f)).length;
    return (covered / allFiles.size) * 100;
  }
}
