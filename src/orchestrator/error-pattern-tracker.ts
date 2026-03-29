/**
 * Error Pattern Tracker — Oturum İçi Hata Kalıpları Takibi
 *
 * Ajanların tekrarlayan hatalarını tespit edip kayıt altına alır.
 * .pc-error-patterns.json dosyasına persist eder.
 * 2+ tekrar eden pattern'ler session sonunda LESSONS.md'ye promote edilir.
 *
 * Tasarım ilkesi #4: Agent Learning
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ErrorPattern, Lesson } from '../types/index.js';

const PATTERNS_FILE = '.pc-error-patterns.json';

export class ErrorPatternTracker {
  private patternsPath: string;
  private patterns: ErrorPattern[] = [];

  constructor(projectRoot: string) {
    this.patternsPath = join(projectRoot, PATTERNS_FILE);
  }

  /** Disk'ten mevcut pattern'leri yükle */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.patternsPath, 'utf-8');
      this.patterns = JSON.parse(content) as ErrorPattern[];
    } catch {
      // Dosya yoksa veya parse hatası — temiz başla
      this.patterns = [];
    }
  }

  /** Pattern'leri diske kaydet */
  async save(): Promise<void> {
    await writeFile(
      this.patternsPath,
      JSON.stringify(this.patterns, null, 2),
      'utf-8'
    );
  }

  /** Hata pattern'i kaydet */
  record(
    taskId: string,
    category: ErrorPattern['category'],
    pattern: string,
    fix: string
  ): void {
    const existing = this.patterns.find(p => p.pattern === pattern);

    if (existing) {
      existing.occurrences++;
      if (!existing.affectedTasks.includes(taskId)) {
        existing.affectedTasks.push(taskId);
      }
      return;
    }

    const id = `EP${String(this.patterns.length + 1).padStart(3, '0')}`;
    this.patterns.push({
      id,
      pattern,
      category,
      occurrences: 1,
      firstSeen: new Date().toISOString(),
      fix,
      affectedTasks: [taskId],
    });
  }

  /** Bilinen tuzakları agent prompt'una enjekte edilecek markdown olarak döndür */
  getKnownPitfalls(): string {
    if (this.patterns.length === 0) return '';

    const lines: string[] = ['\u26a0\ufe0f KNOWN PITFALLS (from this session):'];

    for (const p of this.patterns) {
      lines.push(`- ${p.id} (${p.occurrences}x): ${p.fix}`);
    }

    return lines.join('\n');
  }

  /** 2+ tekrar eden — LESSONS.md'ye promote edilebilir pattern'ler */
  getPromotablePatterns(): ErrorPattern[] {
    return this.patterns.filter(p => p.occurrences >= 2);
  }

  /** Promote edilebilir pattern'leri Lesson formatına dönüştür */
  toLessons(sessionId: string): Lesson[] {
    const promotable = this.getPromotablePatterns();
    const today = new Date().toISOString().slice(0, 10);

    return promotable.map((p, i) => ({
      id: `L${String(i + 1).padStart(3, '0')}`,
      pattern: p.pattern,
      fix: p.fix,
      source: sessionId,
      occurrences: p.occurrences,
      date: today,
    }));
  }

  /** Tüm pattern'leri döndür */
  getPatterns(): ErrorPattern[] {
    return this.patterns;
  }

  /** Bellekteki pattern'leri sıfırla */
  clear(): void {
    this.patterns = [];
  }
}
