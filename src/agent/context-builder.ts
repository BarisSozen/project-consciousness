/**
 * Context Builder — Memory-Aware Prompt Oluşturma
 * 
 * Her agent'a gönderilen prompt, 4 hafıza dosyasının tam bağlamını içerir.
 * Agent tipi ve task'a göre prompt özelleştirilir.
 * 
 * Tasarım İlkesi #1: Memory-First — her karar hafızada iz bırakır.
 */

import type {
  TaskDefinition,
  MemorySnapshot,
  AgentConfig,
  CodebaseContext,
} from '../types/index.js';
import { CodebaseReader } from './codebase-reader.js';
import { ConventionDetector } from './tracer/convention-detector.js';
import { t } from '../i18n/index.js';

/** Agent type → i18n persona key */
function getPersona(agentType: string): string {
  const locale = t();
  switch (agentType) {
    case 'coder': return locale.coderPersona;
    case 'reviewer': return locale.reviewerPersona;
    case 'tester': return locale.testerPersona;
    case 'documenter': return locale.documenterPersona;
    default: return locale.coderPersona;
  }
}

export class ContextBuilder {
  private codebaseReader: CodebaseReader;
  /** Cached convention snippet — detected once per session */
  private conventionSnippet: string | null = null;

  constructor() {
    this.codebaseReader = new CodebaseReader();
  }

  /**
   * Detect project conventions and cache the prompt snippet.
   * Call once before building prompts.
   */
  async detectConventions(projectRoot: string): Promise<string> {
    if (this.conventionSnippet) return this.conventionSnippet;
    try {
      const detector = new ConventionDetector(projectRoot);
      const report = await detector.detect();
      this.conventionSnippet = report.promptSnippet;
    } catch {
      this.conventionSnippet = '';
    }
    return this.conventionSnippet;
  }

  /**
   * Agent için tam prompt oluştur.
   * Yapı: Persona + Conventions + Memory Context + Codebase Context + Task Detail + Output Format
   */
  buildPrompt(
    task: TaskDefinition,
    memory: MemorySnapshot,
    agent: AgentConfig,
    codebaseContext?: CodebaseContext
  ): string {
    const persona = getPersona(agent.type);
    const memoryContext = this.buildMemoryContext(memory);
    const taskDetail = this.buildTaskDetail(task);
    const outputFormat = this.buildOutputFormat(task);
    const locale = t();

    let codebaseSection = '';
    if (codebaseContext && codebaseContext.files.length > 0) {
      codebaseSection = `
═══════════════════════════════════════════════════
CODEBASE
═══════════════════════════════════════════════════

${codebaseContext.summary}
${codebaseContext.truncated ? '\n⚠️ Some files truncated due to token limit.' : ''}
`;
    }

    let conventionSection = '';
    if (this.conventionSnippet) {
      conventionSection = `
═══════════════════════════════════════════════════
PROJECT CONVENTIONS (follow these strictly)
═══════════════════════════════════════════════════

${this.conventionSnippet}
`;
    }

    return `${persona}
${conventionSection}
═══════════════════════════════════════════════════
${locale.memoryContextTitle}
═══════════════════════════════════════════════════

${memoryContext}
${codebaseSection}
═══════════════════════════════════════════════════
${locale.taskSection}
═══════════════════════════════════════════════════

${taskDetail}

═══════════════════════════════════════════════════
${locale.outputFormatSection}
═══════════════════════════════════════════════════

${outputFormat}
`;
  }

  /**
   * Codebase context oluştur — task'a göre ilgili dosyaları bul ve özetle.
   * AgentRunner veya Orchestrator tarafından çağrılır, sonuç buildPrompt'a geçirilir.
   */
  async buildCodebaseContext(
    projectRoot: string,
    taskDescription: string,
    architecture?: string
  ): Promise<CodebaseContext> {
    const structure = await this.codebaseReader.scanProject(projectRoot);
    const relevantFiles = this.codebaseReader.getRelevantFiles(
      taskDescription,
      structure,
      architecture
    );
    return this.codebaseReader.buildContextSummary(relevantFiles, projectRoot);
  }

  /**
   * Hafıza bağlamını oluştur.
   * Otomatik: 20K altı → tam, üstü → compact.
   * MemoryLayer.optimizedSnapshot() ile geliyorsa zaten sıkıştırılmış.
   */
  buildMemoryContext(memory: MemorySnapshot): string {
    const locale = t();
    const sections = [
      this.section(locale.missionLabel, memory.files.mission),
      this.section(locale.architectureLabel, memory.files.architecture),
      this.section(locale.decisionsLabel, memory.files.decisions),
      this.section(locale.stateLabel, memory.files.state),
    ];

    const full = sections.join('\n\n');

    // Token limiti aşılıyorsa (yaklaşık 30K karakter ~ 8K token), özetle
    if (full.length > 30_000) {
      return this.buildCompactMemoryContext(memory);
    }

    return full;
  }

  /**
   * Kompakt hafıza — çok büyük projeler için özet versiyonu
   */
  private buildCompactMemoryContext(memory: MemorySnapshot): string {
    // Mission tam kalır (kısa ve kritik)
    const mission = this.section('MISSION (TAM)', memory.files.mission);
    
    // Architecture'dan sadece ilkeleri al
    const archPrinciples = this.extractSection(memory.files.architecture, '## Tasarım İlkeleri');
    const arch = this.section('ARCHITECTURE (İlkeler)', archPrinciples || 'Bkz. ARCHITECTURE.md');
    
    // Decisions'dan son 5 kararı al
    const recentDecisions = this.extractRecentDecisions(memory.files.decisions, 5);
    const decisions = this.section('DECISIONS (Son 5)', recentDecisions);
    
    // State tam kalır (kısa)
    const state = this.section('STATE (TAM)', memory.files.state);

    return [mission, arch, decisions, state].join('\n\n');
  }

  private buildTaskDetail(task: TaskDefinition): string {
    return `### ${task.id}: ${task.title}

**Açıklama**: ${task.description}

**Tip**: ${task.type}
**Öncelik**: ${task.priority}
**Karmaşıklık**: ${task.estimatedComplexity}

**Bağımlılıklar**: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'Yok'}

**Kabul Kriterleri**:
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

⚠️ ${t().scopeWarning}`;
  }

  private buildOutputFormat(task: TaskDefinition): string {
    return `Çıktını şu yapıda ver:

## Sonuç
[BAŞARILI / BAŞARISIZ / KISMI]

## Yapılanlar
- Madde madde ne yaptın

## Oluşturulan/Değiştirilen Dosyalar
- dosya/yolu.ts — ne değişti

## Kabul Kriterleri Kontrolü
${task.acceptanceCriteria.map((c, i) => `- [ ] ${i + 1}. ${c}`).join('\n')}

## Notlar
Varsa ek notlar, uyarılar, öneriler`;
  }

  // ── Helpers ─────────────────────────────────────────────

  private section(title: string, content: string): string {
    return `### ${title}\n\n${content}`;
  }

  private extractSection(content: string, heading: string): string | null {
    const regex = new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  private extractRecentDecisions(content: string, count: number): string {
    const decisions = content.split(/(?=## D\d{3})/).filter(d => d.startsWith('## D'));
    const recent = decisions.slice(-count);
    return recent.join('\n---\n');
  }
}
