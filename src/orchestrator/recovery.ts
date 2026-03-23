/**
 * Recovery Manager — Crash Recovery
 * 
 * Sistem çökerse kaldığı yerden devam et.
 * .pc-checkpoint.json dosyasına checkpoint yazar.
 * 
 * Tasarım ilkesi #2: Fail-Safe
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Checkpoint } from '../types/index.js';

const CHECKPOINT_FILE = '.pc-checkpoint.json';

export class RecoveryManager {
  private checkpointPath: string;
  private _askFn: ((prompt: string) => Promise<string>) | null = null;

  constructor(projectRoot: string) {
    this.checkpointPath = join(projectRoot, CHECKPOINT_FILE);
  }

  /** Test injection */
  setAskFn(fn: (prompt: string) => Promise<string>): void {
    this._askFn = fn;
  }

  /**
   * Checkpoint kaydet
   */
  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await writeFile(
      this.checkpointPath,
      JSON.stringify(checkpoint, null, 2),
      'utf-8'
    );
  }

  /**
   * Son checkpoint'i oku
   */
  async loadCheckpoint(): Promise<Checkpoint | null> {
    try {
      const content = await readFile(this.checkpointPath, 'utf-8');
      return JSON.parse(content) as Checkpoint;
    } catch {
      return null;
    }
  }

  /**
   * Resume edilebilir checkpoint var mı?
   */
  async canResume(): Promise<boolean> {
    try {
      await access(this.checkpointPath);
      const checkpoint = await this.loadCheckpoint();
      return checkpoint !== null && checkpoint.milestoneId !== '';
    } catch {
      return false;
    }
  }

  /**
   * Checkpoint'i sil (temiz başlangıç veya tamamlanma sonrası)
   */
  async clearCheckpoint(): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.checkpointPath);
    } catch {
      // dosya yoksa sorun değil
    }
  }

  /**
   * Kullanıcıya devam etmek isteyip istemediğini sor
   */
  async promptResume(checkpoint: Checkpoint): Promise<boolean> {
    const msg = `\n📌 Önceki session bulundu:
  Session: ${checkpoint.sessionId}
  Milestone: ${checkpoint.milestoneId}
  Tamamlanan: ${checkpoint.completedMilestones.length} milestone, ${checkpoint.completedTasks.length} task
  Tarih: ${checkpoint.timestamp}

  Devam edilsin mi? (e/h): `;

    const answer = await this.ask(msg);
    return answer.trim().toLowerCase().startsWith('e');
  }

  /**
   * Hangi milestone'dan devam edileceğini hesapla
   */
  getResumePoint(checkpoint: Checkpoint): { milestoneId: string; completedTasks: Set<string> } {
    return {
      milestoneId: checkpoint.milestoneId,
      completedTasks: new Set(checkpoint.completedTasks),
    };
  }

  private ask(prompt: string): Promise<string> {
    if (this._askFn) return this._askFn(prompt);

    return new Promise((resolve) => {
      const { createInterface } = require('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (answer: string) => { rl.close(); resolve(answer); });
    });
  }
}
