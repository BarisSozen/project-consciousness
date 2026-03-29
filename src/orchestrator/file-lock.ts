/**
 * File Lock Manager — Paralel Agent Çakışma Önleyici
 *
 * Multi-agent orkestrasyon sisteminde birden fazla agent aynı anda
 * aynı dosyayı düzenlemeye çalışabilir. Bu modül dosya seviyesinde
 * kilit yönetimi sağlayarak çakışmaları önler.
 */

import type { LockResult, FileLockConflict } from '../types/index.js';

export class FileLockManager {
  /** filepath → taskId: kilidi tutan task */
  private locks: Map<string, string> = new Map();

  // ── Kilit Alma ─────────────────────────────────────────

  /**
   * Belirtilen dosyalar için kilit almayı dene.
   * Herhangi bir dosya başka bir task tarafından kilitliyse,
   * hiçbir kilit alınmaz ve çakışma listesi döner (atomik).
   */
  acquire(taskId: string, filePaths: string[]): LockResult {
    const conflicts: FileLockConflict[] = [];

    for (const file of filePaths) {
      const holder = this.locks.get(file);
      if (holder !== undefined && holder !== taskId) {
        conflicts.push({ file, heldBy: holder });
      }
    }

    if (conflicts.length > 0) {
      return { acquired: false, conflicts };
    }

    // Çakışma yok — tüm dosyaları kilitle
    for (const file of filePaths) {
      this.locks.set(file, taskId);
    }

    return { acquired: true, conflicts: [] };
  }

  // ── Kilit Bırakma ─────────────────────────────────────

  /**
   * Belirtilen task'ın tuttuğu tüm kilitleri serbest bırak.
   * Serbest bırakılan dosya yollarını döndürür.
   */
  release(taskId: string): string[] {
    const released: string[] = [];

    for (const [file, holder] of this.locks) {
      if (holder === taskId) {
        released.push(file);
      }
    }

    for (const file of released) {
      this.locks.delete(file);
    }

    return released;
  }

  // ── Sorgulama ──────────────────────────────────────────

  /**
   * Belirtilen dosya kilitli mi?
   */
  isLocked(filePath: string): boolean {
    return this.locks.has(filePath);
  }

  /**
   * Dosyayı kilitleyen task'ın ID'sini döndür.
   * Kilitli değilse null döner.
   */
  getHolder(filePath: string): string | null {
    return this.locks.get(filePath) ?? null;
  }

  /**
   * Bir task'ın kilitlediği tüm dosya yollarını döndür.
   */
  getLocksForTask(taskId: string): string[] {
    const files: string[] = [];
    for (const [file, holder] of this.locks) {
      if (holder === taskId) {
        files.push(file);
      }
    }
    return files;
  }

  // ── Toplu İşlemler ─────────────────────────────────────

  /**
   * Tüm kilitleri temizle (session cleanup için).
   */
  releaseAll(): void {
    this.locks.clear();
  }

  /**
   * Aktif kilitlerin bir kopyasını döndür.
   * Orijinal Map'e dışarıdan müdahale edilmesini önler.
   */
  getActiveLocks(): Map<string, string> {
    return new Map(this.locks);
  }
}

// ── Standalone Helper ──────────────────────────────────────

/** Keyword → muhtemel hedef dizin eşleştirmesi */
const KEYWORD_DIR_MAP: Array<{ keywords: string[]; dirs: string[] }> = [
  { keywords: ['route', 'controller', 'endpoint', 'api'],  dirs: ['src/routes/'] },
  { keywords: ['service', 'handler', 'logic', 'usecase'],  dirs: ['src/services/'] },
  { keywords: ['model', 'schema', 'entity', 'type'],       dirs: ['src/types/', 'src/models/'] },
  { keywords: ['test', 'spec'],                             dirs: ['src/__tests__/', 'tests/'] },
  { keywords: ['middleware', 'auth', 'guard'],              dirs: ['src/middleware/'] },
  { keywords: ['config', 'env', 'setup'],                   dirs: ['src/config/'] },
];

/**
 * Task description'ından muhtemel dosya yollarını tahmin et.
 * Heuristic: "route", "service", "model" gibi keyword'lerden dosya path'leri çıkar.
 *
 * @param taskDescription - Task'ın açıklama metni
 * @param projectRoot - Proje kök dizini (ör. "/home/user/my-project")
 * @returns Tahmini hedef dizin yolları (projectRoot ile prefix'li)
 */
export function estimateTargetFiles(taskDescription: string, projectRoot: string): string[] {
  const lower = taskDescription.toLowerCase();
  const matched = new Set<string>();

  for (const entry of KEYWORD_DIR_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        for (const dir of entry.dirs) {
          const normalized = projectRoot.endsWith('/')
            ? `${projectRoot}${dir}`
            : `${projectRoot}/${dir}`;
          matched.add(normalized);
        }
        break; // bu grubun ilk eşleşmesi yeterli
      }
    }
  }

  return [...matched];
}
