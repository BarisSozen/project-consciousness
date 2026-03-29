/**
 * Memory Layer — Dört Dosyanın Guardianı
 * 
 * MISSION.md:       salt okunur (sadece validasyon)
 * ARCHITECTURE.md:  okunur, değişiklik önerisi üretir
 * DECISIONS.md:     append-only log
 * STATE.md:         her task sonrası güncellenir
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  MemoryFiles,
  MemorySnapshot,
  Decision,
  StateData,
  Phase,
  TaskStatus,
  BlockedTask,
  Lesson
} from '../types/index.js';

export class MemoryLayer {
  private paths: Record<keyof MemoryFiles, string>;
  private backupDir: string;

  constructor(projectRoot: string) {
    this.paths = {
      mission: join(projectRoot, 'MISSION.md'),
      architecture: join(projectRoot, 'ARCHITECTURE.md'),
      decisions: join(projectRoot, 'DECISIONS.md'),
      state: join(projectRoot, 'STATE.md'),
      lessons: join(projectRoot, 'LESSONS.md'),
    };
    this.backupDir = join(projectRoot, '.pc-backup');
  }

  // ── Snapshot: Tüm hafızayı tek seferde oku ──────────────

  async snapshot(): Promise<MemorySnapshot> {
    const files = await this.readAll();
    const hash = this.computeHash(files);
    return {
      files,
      timestamp: new Date().toISOString(),
      hash,
    };
  }

  /**
   * Optimize edilmiş snapshot — context window'u korumak için
   * DECISIONS.md ve STATE.md otomatik sıkıştırılır.
   * 
   * @param recentDecisionCount Tam gösterilecek son karar sayısı (default: 10)
   * @param maxCompletedTasks Tam gösterilecek max tamamlanan task (default: 5)
   */
  async optimizedSnapshot(
    recentDecisionCount = 10,
    maxCompletedTasks = 5
  ): Promise<MemorySnapshot> {
    const [mission, architecture, decisionsRaw, stateRaw, lessons] = await Promise.all([
      this.readFile('mission'),
      this.readFile('architecture'),
      this.readFile('decisions'),
      this.readFile('state'),
      this.readFile('lessons'),
    ]);

    const decisions = this.summarizeDecisions(decisionsRaw, recentDecisionCount);
    const state = this.compressState(stateRaw, maxCompletedTasks);

    const files: MemoryFiles = { mission, architecture, decisions, state, lessons };
    return {
      files,
      timestamp: new Date().toISOString(),
      hash: this.computeHash(files),
    };
  }

  async readAll(): Promise<MemoryFiles> {
    const [mission, architecture, decisions, state, lessons] = await Promise.all([
      this.readFile('mission'),
      this.readFile('architecture'),
      this.readFile('decisions'),
      this.readFile('state'),
      this.readFile('lessons'),
    ]);
    return { mission, architecture, decisions, state, lessons };
  }

  // ── Individual File Operations ──────────────────────────

  async readMission(): Promise<string> {
    return this.readFile('mission');
  }

  async readArchitecture(): Promise<string> {
    return this.readFile('architecture');
  }

  async readDecisions(): Promise<string> {
    return this.readFile('decisions');
  }

  async readState(): Promise<string> {
    return this.readFile('state');
  }

  async readLessons(): Promise<string> {
    return this.readFile('lessons');
  }

  // ── DECISIONS.md: Append-Only ───────────────────────────

  async appendDecision(decision: Decision): Promise<void> {
    const current = await this.readDecisions();
    
    const entry = `
---

## ${decision.id} — ${decision.title}

- **Tarih**: ${decision.date}
- **Bağlam**: ${decision.context}
- **Karar**: ${decision.decision}
- **Gerekçe**: ${decision.rationale}
- **Alternatifler**: ${decision.alternatives}
- **Durum**: ${decision.status}
`;
    
    await this.atomicWrite('decisions', current + entry);
  }

  // ── LESSONS.md: Append-Only ─────────────────────────────

  async appendLesson(lesson: Lesson): Promise<void> {
    const current = await this.readLessons();
    const entry = `
---

## ${lesson.id} — ${lesson.pattern}

- **Çözüm**: ${lesson.fix}
- **Kaynak**: ${lesson.source}
- **Tekrar**: ${lesson.occurrences}x
- **Tarih**: ${lesson.date}
`;
    await this.atomicWrite('lessons', current + entry);
  }

  // ── STATE.md: Full Rewrite ──────────────────────────────

  async updateState(state: StateData): Promise<void> {
    const content = this.renderState(state);
    await this.atomicWrite('state', content);
  }

  async parseState(): Promise<StateData> {
    const content = await this.readState();
    return this.parseStateContent(content);
  }

  // ── Validation ──────────────────────────────────────────

  async validateMissionIntegrity(): Promise<boolean> {
    const mission = await this.readMission();
    // Mission dosyası boş olmamalı ve temel bölümleri içermeli
    return (
      mission.includes('## Neden Varız') &&
      mission.includes('## Ne İnşa Ediyoruz') &&
      mission.includes('## Başarı Tanımı')
    );
  }

  async getDecisionCount(): Promise<number> {
    const content = await this.readDecisions();
    const matches = content.match(/^## D\d+/gm);
    return matches?.length ?? 0;
  }

  async getNextDecisionId(): Promise<string> {
    const count = await this.getDecisionCount();
    return `D${String(count + 1).padStart(3, '0')}`;
  }

  // ── Memory Optimization ─────────────────────────────────

  /**
   * DECISIONS.md özetleme:
   * - Son N karar tam gösterilir
   * - Eskiler tek satır özete indirilir
   * 
   * Örnek: "D001-D006: dosya tabanlı hafıza, TypeScript stack, Claude API kararları"
   */
  summarizeDecisions(raw: string, recentCount = 10): string {
    // Header'ı ayır
    const headerMatch = raw.match(/^([\s\S]*?)(?=\n---\n|\n## D\d)/);
    const header = headerMatch?.[1]?.trim() ?? '# DECISIONS';

    // Kararları parse et
    const decisionBlocks = raw.split(/(?=\n---\n\s*\n## D\d)/).filter(b => /## D\d/.test(b));

    if (decisionBlocks.length <= recentCount) {
      return raw; // sıkıştırma gereksiz
    }

    const oldCount = decisionBlocks.length - recentCount;
    const oldBlocks = decisionBlocks.slice(0, oldCount);
    const recentBlocks = decisionBlocks.slice(oldCount);

    // Eski kararları özetle
    const oldSummaries = oldBlocks.map(block => {
      const idMatch = block.match(/## (D\d+)\s*—\s*(.+)/);
      const id = idMatch?.[1] ?? '?';
      const title = idMatch?.[2]?.trim() ?? 'untitled';
      return `${id}: ${title}`;
    });

    // Grup halinde özetle (max 5 per line)
    const summaryLines: string[] = [];
    for (let i = 0; i < oldSummaries.length; i += 5) {
      const chunk = oldSummaries.slice(i, i + 5);
      const firstId = chunk[0]?.split(':')[0] ?? '';
      const lastId = chunk[chunk.length - 1]?.split(':')[0] ?? '';
      const titles = chunk.map(s => s.split(': ').slice(1).join(': ')).join(', ');
      summaryLines.push(`**${firstId}-${lastId}**: ${titles}`);
    }

    const summary = `${header}

> ℹ️ ${oldCount} eski karar özetlendi, son ${recentCount} tam gösteriliyor.

### Özetlenen Kararlar
${summaryLines.map(l => `- ${l}`).join('\n')}
${recentBlocks.join('')}`;

    return summary;
  }

  /**
   * STATE.md sıkıştırma:
   * - Completed tasks 5'ten fazlaysa özete indir
   * - Active tasks ve blocked tam kalır
   */
  compressState(raw: string, maxCompleted = 5): string {
    const state = this.parseStateContent(raw);
    
    if (state.completedTasks.length <= maxCompleted) {
      return raw; // sıkıştırma gereksiz
    }

    const totalCompleted = state.completedTasks.length;
    const recent = state.completedTasks.slice(-maxCompleted);

    // Sıkıştırılmış render
    const activeTasks = state.activeTasks
      .map(t => `- [ ] ${t.taskId} — ${t.title} — status: ${t.status}`)
      .join('\n');

    const recentTasks = recent
      .map(t => `- [x] ${t.taskId} — ${t.title}`)
      .join('\n');

    const blockedTasks = state.blockedTasks
      .map(t => `- ${t.taskId} — ${t.reason} — ${t.escalationStatus}`)
      .join('\n');

    return `# STATE — Project Consciousness

## Current Phase: \`${state.phase}\`

## Iteration: ${state.iteration}

## Active Tasks
${activeTasks || '_yok_'}

## Completed Tasks
> ${totalCompleted} task tamamlandı (son ${maxCompleted} gösteriliyor, detay: git log)

${recentTasks}

## Blocked
${blockedTasks || '_yok_'}

## Last Updated: ${state.lastUpdated}
`;
  }

  // ── Private Helpers ─────────────────────────────────────

  private async readFile(key: keyof MemoryFiles): Promise<string> {
    try {
      return await readFile(this.paths[key], 'utf-8');
    } catch {
      if (key === 'lessons') return ''; // LESSONS.md may not exist yet
      throw new Error(`Memory file not found: ${this.paths[key]}`);
    }
  }

  /**
   * Atomic dosya yazma — write-then-rename pattern.
   * Yazma sırasında crash olursa orijinal dosya bozulmaz.
   */
  private async atomicWrite(key: keyof MemoryFiles, content: string): Promise<void> {
    const { mkdir, writeFile: wf, rename } = await import('node:fs/promises');
    const filePath = this.paths[key];
    const tmpPath = filePath + '.tmp';

    // Backup oluştur
    await mkdir(this.backupDir, { recursive: true });
    try {
      const existing = await readFile(filePath, 'utf-8');
      await wf(join(this.backupDir, `${key}.bak`), existing, 'utf-8');
    } catch {
      // İlk yazma — backup yok, sorun değil
    }

    // Atomic write: tmp → rename
    await wf(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  }

  /**
   * Backup'tan dosya kurtarma — bozuk dosya tespit edildiğinde kullanılır.
   */
  async restoreFromBackup(key: keyof MemoryFiles): Promise<boolean> {
    try {
      const backupPath = join(this.backupDir, `${key}.bak`);
      const backup = await readFile(backupPath, 'utf-8');
      await writeFile(this.paths[key], backup, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private computeHash(files: MemoryFiles): string {
    const content = Object.values(files).join('\n---\n');
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
  }

  private renderState(state: StateData): string {
    const activeTasks = state.activeTasks
      .map(t => `- [ ] ${t.taskId} — ${t.title} — agent: ${t.assignedAgent ?? 'unassigned'} — status: ${t.status}`)
      .join('\n');

    const completedTasks = state.completedTasks
      .map(t => `- [x] ${t.taskId} — ${t.title} — ${t.output ?? 'done'}`)
      .join('\n');

    const blockedTasks = state.blockedTasks
      .map(t => `- ${t.taskId} — ${t.reason} — ${t.escalationStatus}`)
      .join('\n');

    return `# STATE — Project Consciousness

## Current Phase: \`${state.phase}\`

## Iteration: ${state.iteration}

## Active Tasks
${activeTasks || '_yok_'}

## Completed Tasks
${completedTasks || '_henüz yok_'}

## Blocked
${blockedTasks || '_henüz yok_'}

## Last Updated: ${state.lastUpdated}
`;
  }

  private parseStateContent(content: string): StateData {
    const phaseMatch = content.match(/## Current Phase: `(\w+)`/);
    const iterationMatch = content.match(/## Iteration: (\d+)/);
    
    const phase = (phaseMatch?.[1] ?? 'initialization') as Phase;
    const iteration = parseInt(iterationMatch?.[1] ?? '0', 10);

    // Parse active tasks
    const activeTasks = this.parseTaskLines(content, 'Active Tasks', false);
    const completedTasks = this.parseTaskLines(content, 'Completed Tasks', true);
    const blockedTasks = this.parseBlockedLines(content);

    return {
      phase,
      iteration,
      activeTasks,
      completedTasks,
      blockedTasks,
      lastUpdated: new Date().toISOString(),
    };
  }

  private parseTaskLines(content: string, section: string, completed: boolean): TaskStatus[] {
    const sectionRegex = new RegExp(`## ${section}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(sectionRegex);
    if (!match?.[1]) return [];

    const lines = match[1].trim().split('\n').filter(l => l.startsWith('- ['));
    return lines.map(line => {
      const parts = line.replace(/^- \[[ x]\] /, '').split(' — ');
      return {
        taskId: parts[0]?.trim() ?? '',
        title: parts[1]?.trim() ?? '',
        status: completed ? 'done' as const : 'pending' as const,
        assignedAgent: undefined,
      };
    });
  }

  private parseBlockedLines(content: string): BlockedTask[] {
    const match = content.match(/## Blocked\n([\s\S]*?)(?=\n## |$)/);
    if (!match?.[1] || match[1].includes('_henüz yok_')) return [];

    const lines = match[1].trim().split('\n').filter(l => l.startsWith('- '));
    return lines.map(line => {
      const parts = line.replace(/^- /, '').split(' — ');
      return {
        taskId: parts[0]?.trim() ?? '',
        reason: parts[1]?.trim() ?? '',
        escalationStatus: 'pending' as const,
      };
    });
  }
}
