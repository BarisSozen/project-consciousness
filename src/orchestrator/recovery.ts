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
import type { Checkpoint, RetryContext } from '../types/index.js';

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
   * Checkpoint'i kısmen güncelle — tam yeniden yazma gerektirmez.
   * Mevcut checkpoint'i oku, merge et, yaz.
   */
  async updateCheckpoint(partial: Partial<Checkpoint>): Promise<void> {
    const current = await this.loadCheckpoint();
    if (!current) {
      throw new Error('No existing checkpoint to update');
    }
    const merged: Checkpoint = { ...current, ...partial, timestamp: new Date().toISOString() };
    await this.saveCheckpoint(merged);
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
   * Sub-task tamamlandığında checkpoint'e ekle.
   */
  async addCompletedSubTask(subTaskId: string): Promise<void> {
    const current = await this.loadCheckpoint();
    if (!current) return;
    if (!current.completedSubTasks.includes(subTaskId)) {
      current.completedSubTasks.push(subTaskId);
      current.timestamp = new Date().toISOString();
      await this.saveCheckpoint(current);
    }
  }

  /**
   * Agent'ın ürettiği dosyayı pending artifacts'a ekle.
   */
  async addPendingArtifact(filePath: string): Promise<void> {
    const current = await this.loadCheckpoint();
    if (!current) return;
    if (!current.pendingArtifacts.includes(filePath)) {
      current.pendingArtifacts.push(filePath);
      current.timestamp = new Date().toISOString();
      await this.saveCheckpoint(current);
    }
  }

  /**
   * Retry context'i kaydet — agent tekrar çalıştırılacaksa hata bilgisini sakla.
   */
  async setRetryContext(retryContext: RetryContext): Promise<void> {
    await this.updateCheckpoint({ retryContext });
  }

  /**
   * Retry başarılı olduktan sonra retry context'i temizle.
   */
  async clearRetryContext(): Promise<void> {
    const current = await this.loadCheckpoint();
    if (!current) return;
    delete current.retryContext;
    current.timestamp = new Date().toISOString();
    await this.saveCheckpoint(current);
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
    const currentTask = checkpoint.currentTaskId ? `\n  Aktif Task: ${checkpoint.currentTaskId}` : '';
    const subTasks = checkpoint.completedSubTasks.length > 0
      ? `\n  Sub-tasks: ${checkpoint.completedSubTasks.length} tamamlandı`
      : '';
    const artifacts = checkpoint.pendingArtifacts.length > 0
      ? `\n  Bekleyen Dosyalar: ${checkpoint.pendingArtifacts.length} dosya commit edilmemiş`
      : '';
    const retry = checkpoint.retryContext
      ? `\n  ⚠️ Son task retry bekliyor (attempt ${checkpoint.retryContext.attempt})`
      : '';

    const msg = `\n📌 Önceki session bulundu:
  Session: ${checkpoint.sessionId}
  Milestone: ${checkpoint.milestoneId}
  Tamamlanan: ${checkpoint.completedMilestones.length} milestone, ${checkpoint.completedTasks.length} task${currentTask}${subTasks}${artifacts}${retry}
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
