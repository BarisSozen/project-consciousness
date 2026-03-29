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
  AgentType,
  CodebaseContext,
  TokenBudget,
  ContextProfile,
  RetryContext,
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

// ── Agent-Specific Context Profiles ──────────────────────────

const CONTEXT_PROFILES: Record<AgentType, ContextProfile> = {
  coder: {
    memoryPriority: ['architecture', 'state', 'lessons', 'decisions', 'mission'],
    codebaseFocus: 'implementation-files',
    includeTestHistory: false,
  },
  tester: {
    memoryPriority: ['state', 'mission', 'lessons', 'architecture', 'decisions'],
    codebaseFocus: 'test-files-and-interfaces',
    includeTestHistory: true,
  },
  reviewer: {
    memoryPriority: ['mission', 'decisions', 'lessons', 'architecture', 'state'],
    codebaseFocus: 'changed-files',
    includeTestHistory: true,
  },
  documenter: {
    memoryPriority: ['architecture', 'mission', 'state', 'lessons', 'decisions'],
    codebaseFocus: 'public-api-files',
    includeTestHistory: false,
  },
  tracer: {
    memoryPriority: ['architecture', 'state', 'decisions', 'mission', 'lessons'],
    codebaseFocus: 'all',
    includeTestHistory: false,
  },
};

// ── Token Budget Defaults ────────────────────────────────────

const DEFAULT_TOKEN_LIMIT = 8192;
const FIXED_PERSONA_TOKENS = 500;
const FIXED_CONVENTION_TOKENS = 300;

/** Tahmini token sayısı — heuristic: chars / 3.5 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Metni verilen token limitine kırp */
function trimToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n... (trimmed to fit token budget)';
}

export class ContextBuilder {
  private codebaseReader: CodebaseReader;
  /** Cached convention snippet — detected once per session */
  private conventionSnippet: string | null = null;
  /** Known pitfalls from error pattern tracker */
  private knownPitfalls: string = '';
  /** Token limit per agent */
  private tokenLimit: number = DEFAULT_TOKEN_LIMIT;

  constructor(tokenLimit?: number) {
    this.codebaseReader = new CodebaseReader();
    if (tokenLimit) this.tokenLimit = tokenLimit;
  }

  /** Error pattern tracker'dan gelen bilinen hatalar */
  setKnownPitfalls(pitfalls: string): void {
    this.knownPitfalls = pitfalls;
  }

  /** Agent token limitini ayarla */
  setTokenLimit(limit: number): void {
    this.tokenLimit = limit;
  }

  /** Verilen agent tipi için context profile döndür */
  getProfile(agentType: AgentType): ContextProfile {
    return CONTEXT_PROFILES[agentType] ?? CONTEXT_PROFILES.coder;
  }

  /** Token bütçesini hesapla */
  computeBudget(): TokenBudget {
    const remaining = this.tokenLimit - FIXED_PERSONA_TOKENS - FIXED_CONVENTION_TOKENS;
    return {
      total: this.tokenLimit,
      persona: FIXED_PERSONA_TOKENS,
      conventions: FIXED_CONVENTION_TOKENS,
      memory: Math.floor(remaining * 0.40),
      codebase: Math.floor(remaining * 0.35),
      task: Math.floor(remaining * 0.25),
    };
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
   * Yapı: Persona + Conventions + Pitfalls + Memory Context + Codebase Context + Retry + Task Detail + Output Format
   * Token-aware: her bölüm bütçeye göre kırpılır.
   */
  buildPrompt(
    task: TaskDefinition,
    memory: MemorySnapshot,
    agent: AgentConfig,
    codebaseContext?: CodebaseContext,
    retryContext?: RetryContext
  ): string {
    const budget = this.computeBudget();
    const profile = this.getProfile(agent.type);
    const persona = getPersona(agent.type);
    const memoryContext = this.buildProfiledMemoryContext(memory, profile, budget.memory);
    const taskDetail = this.buildTaskDetail(task);
    const outputFormat = this.buildOutputFormat(task);
    const locale = t();

    let codebaseSection = '';
    if (codebaseContext && codebaseContext.files.length > 0) {
      const codebaseMd = `${codebaseContext.summary}${codebaseContext.truncated ? '\n⚠️ Some files truncated due to token limit.' : ''}`;
      codebaseSection = `
═══════════════════════════════════════════════════
CODEBASE
═══════════════════════════════════════════════════

${trimToTokenBudget(codebaseMd, budget.codebase)}
`;
    }

    let conventionSection = '';
    const conventionParts: string[] = [];
    if (this.conventionSnippet) conventionParts.push(this.conventionSnippet);
    if (this.knownPitfalls) conventionParts.push(this.knownPitfalls);
    if (conventionParts.length > 0) {
      conventionSection = `
═══════════════════════════════════════════════════
PROJECT CONVENTIONS (follow these strictly)
═══════════════════════════════════════════════════

${conventionParts.join('\n\n')}
`;
    }

    let retrySection = '';
    if (retryContext) {
      retrySection = `
═══════════════════════════════════════════════════
PREVIOUS ATTEMPT (FAILED — attempt ${retryContext.attempt}/${3})
═══════════════════════════════════════════════════

Your previous output had these issues:
${retryContext.specificFixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${retryContext.failedChecks.length > 0 ? `\nFailed checks:\n${retryContext.failedChecks.map(c => `- ${c}`).join('\n')}` : ''}

Fix these specific issues. Do NOT repeat them.
`;
    }

    return `${persona}
${conventionSection}
═══════════════════════════════════════════════════
${locale.memoryContextTitle}
═══════════════════════════════════════════════════

${memoryContext}
${codebaseSection}${retrySection}
═══════════════════════════════════════════════════
${locale.taskSection}
═══════════════════════════════════════════════════

${trimToTokenBudget(taskDetail, budget.task)}

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
   * Agent profiline göre önceliklendirilmiş hafıza bağlamı.
   * Öncelikli dosyalar tam gösterilir, düşük öncelikliler kırpılır.
   */
  buildProfiledMemoryContext(
    memory: MemorySnapshot,
    profile: ContextProfile,
    tokenBudget: number
  ): string {
    const locale = t();
    const labelMap: Record<string, string> = {
      mission: locale.missionLabel,
      architecture: locale.architectureLabel,
      decisions: locale.decisionsLabel,
      state: locale.stateLabel,
      lessons: 'LESSONS',
    };

    const sections: string[] = [];
    let usedTokens = 0;

    // Profile'daki öncelik sırasına göre memory dosyalarını ekle
    for (const key of profile.memoryPriority) {
      const content = memory.files[key as keyof typeof memory.files];
      if (!content) continue;

      const label = labelMap[key] ?? key.toUpperCase();
      const sectionTokens = estimateTokens(content);
      const remainingBudget = tokenBudget - usedTokens;

      if (remainingBudget <= 0) break;

      if (sectionTokens <= remainingBudget) {
        sections.push(this.section(label, content));
        usedTokens += sectionTokens;
      } else {
        // Kalan bütçeye sığdır
        sections.push(this.section(label + ' (trimmed)', trimToTokenBudget(content, remainingBudget)));
        usedTokens += remainingBudget;
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Hafıza bağlamını oluştur (eski API — backward compat).
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

    // LESSONS.md varsa ekle
    if (memory.files.lessons) {
      sections.push(this.section('LESSONS', memory.files.lessons));
    }

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
