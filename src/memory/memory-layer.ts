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
  BlockedTask 
} from '../types/index.js';

export class MemoryLayer {
  private paths: Record<keyof MemoryFiles, string>;

  constructor(projectRoot: string) {
    this.paths = {
      mission: join(projectRoot, 'MISSION.md'),
      architecture: join(projectRoot, 'ARCHITECTURE.md'),
      decisions: join(projectRoot, 'DECISIONS.md'),
      state: join(projectRoot, 'STATE.md'),
    };
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

  async readAll(): Promise<MemoryFiles> {
    const [mission, architecture, decisions, state] = await Promise.all([
      this.readFile('mission'),
      this.readFile('architecture'),
      this.readFile('decisions'),
      this.readFile('state'),
    ]);
    return { mission, architecture, decisions, state };
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
    
    await writeFile(this.paths.decisions, current + entry, 'utf-8');
  }

  // ── STATE.md: Full Rewrite ──────────────────────────────

  async updateState(state: StateData): Promise<void> {
    const content = this.renderState(state);
    await writeFile(this.paths.state, content, 'utf-8');
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

  // ── Private Helpers ─────────────────────────────────────

  private async readFile(key: keyof MemoryFiles): Promise<string> {
    try {
      return await readFile(this.paths[key], 'utf-8');
    } catch {
      throw new Error(`Memory file not found: ${this.paths[key]}`);
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
