/**
 * Orphan Detector — Sahipsiz Dosya Kurtarma
 *
 * Crash sonrası restart'ta:
 * 1. Git'te unstaged changes'ı tara
 * 2. Checkpoint'taki pendingArtifacts ile karşılaştır
 * 3. Eşleşen dosyalar = kurtarılabilir, eşleşmeyenler = uyarı
 *
 * Tasarım ilkesi #2: Fail-Safe — veri kaybını önle
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Checkpoint, OrphanReport } from '../types/index.js';

export class OrphanDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Git unstaged/untracked dosyaları tespit et ve checkpoint ile karşılaştır.
   */
  async detect(checkpoint: Checkpoint | null): Promise<OrphanReport> {
    const unstaged = await this.getUnstagedFiles();

    if (!checkpoint || checkpoint.pendingArtifacts.length === 0) {
      return {
        matched: [],
        unmatched: unstaged,
        hasOrphans: unstaged.length > 0,
      };
    }

    const pendingSet = new Set(checkpoint.pendingArtifacts);
    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const file of unstaged) {
      if (pendingSet.has(file)) {
        matched.push(file);
      } else {
        unmatched.push(file);
      }
    }

    return {
      matched,
      unmatched,
      hasOrphans: matched.length > 0 || unmatched.length > 0,
    };
  }

  /**
   * Eşleşen dosyaların diskte var olduğunu doğrula.
   */
  async verifyFiles(filePaths: string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const file of filePaths) {
      try {
        await access(join(this.projectRoot, file));
        existing.push(file);
      } catch {
        // Dosya silinmiş olabilir
      }
    }
    return existing;
  }

  /**
   * Kullanıcıya gösterilecek özet rapor oluştur.
   */
  formatReport(report: OrphanReport): string {
    if (!report.hasOrphans) {
      return '  Sahipsiz dosya bulunamadı.';
    }

    const lines: string[] = [];

    if (report.matched.length > 0) {
      lines.push(`\n  Kurtarılabilir Dosyalar (önceki session'dan):`);
      for (const file of report.matched) {
        lines.push(`    + ${file}`);
      }
    }

    if (report.unmatched.length > 0) {
      lines.push(`\n  Bilinmeyen Dosyalar (checkpoint'ta yok):`);
      for (const file of report.unmatched) {
        lines.push(`    ? ${file}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Git'ten modified + untracked dosyaları al.
   */
  private getUnstagedFiles(): Promise<string[]> {
    return new Promise((resolve) => {
      exec(
        'git status --porcelain',
        { cwd: this.projectRoot },
        (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }

          const files = stdout
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => line.slice(3).trim()) // " M file.ts" → "file.ts"
            .filter(file => !file.startsWith('.pc-')); // checkpoint/backup dosyalarını hariç tut

          resolve(files);
        }
      );
    });
  }
}
