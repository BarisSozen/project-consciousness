/**
 * Dynamic Scheduler — Olay Tabanlı Görev Zamanlayıcı
 *
 * Statik grup bazlı yürütmeyi canlı hazır-kuyruk ile değiştirir.
 * Bağımlılıklar tamamlandıkça görevleri otomatik olarak hazır kuyruğa alır.
 * Başarısız görevlerin tüm transitif bağımlılarını atlayarak
 * gereksiz yürütmeleri önler.
 */

import type { TaskDefinition } from '../types/index.js';

/** Öncelik sıralaması — düşük değer = yüksek öncelik */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class DynamicScheduler {
  /** Tüm görevler — ID → tanım eşlemesi */
  private tasks: Map<string, TaskDefinition> = new Map();

  /** Tamamlanan görev ID'leri */
  private completed: Set<string> = new Set();

  /** Başarısız olan görev ID'leri */
  private failed: Set<string> = new Set();

  /** Şu anda çalışmakta olan görev ID'leri */
  private running: Set<string> = new Set();

  /** Başarısız bağımlılık nedeniyle atlanan görev ID'leri */
  private skipped: Set<string> = new Set();

  // ── Yükleme ──────────────────────────────────────────────

  /**
   * Görev listesini zamanlayıcıya yükler.
   * Mevcut durumu sıfırlar ve tüm görevleri kaydeder.
   */
  loadTasks(tasks: TaskDefinition[]): void {
    this.tasks.clear();
    this.completed.clear();
    this.failed.clear();
    this.running.clear();
    this.skipped.clear();

    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  // ── Hazır Kuyruk ─────────────────────────────────────────

  /**
   * Bağımlılıkları tamamen karşılanmış ve henüz çalışmaya başlamamış
   * görevleri döndürür. Öncelik sırasına göre sıralıdır (critical > high > medium > low).
   */
  getReady(): TaskDefinition[] {
    const ready: TaskDefinition[] = [];

    for (const [id, task] of this.tasks) {
      // Zaten sonuçlanmış veya çalışan görevleri atla
      if (
        this.completed.has(id) ||
        this.failed.has(id) ||
        this.running.has(id) ||
        this.skipped.has(id)
      ) {
        continue;
      }

      // Tüm bağımlılıklar tamamlanmış mı?
      const allDepsCompleted = task.dependencies.every(dep =>
        this.completed.has(dep),
      );

      if (allDepsCompleted) {
        ready.push(task);
      }
    }

    // Önceliğe göre deterministik sıralama
    ready.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      // Aynı öncelikte ID'ye göre sırala — determinizm için
      return a.id.localeCompare(b.id);
    });

    return ready;
  }

  // ── Durum Geçişleri ──────────────────────────────────────

  /**
   * Görevi çalışma durumuna taşır.
   */
  markRunning(taskId: string): void {
    this.running.add(taskId);
  }

  /**
   * Görevi tamamlandı olarak işaretler, çalışma setinden çıkarır.
   * Yeni açılan (bağımlılıkları karşılanan) görevleri döndürür.
   */
  markDone(taskId: string): TaskDefinition[] {
    this.completed.add(taskId);
    this.running.delete(taskId);

    return this.getReady();
  }

  /**
   * Görevi başarısız olarak işaretler, çalışma setinden çıkarır.
   * Tüm transitif bağımlıları (doğrudan + dolaylı) atlanmış olarak işaretler.
   * Atlanan görev ID'lerini döndürür.
   */
  markFailed(taskId: string): string[] {
    this.failed.add(taskId);
    this.running.delete(taskId);

    const transitiveDependents = this.findTransitiveDependents(taskId);

    for (const depId of transitiveDependents) {
      // Zaten tamamlanmış veya başarısız görevleri atlamayız
      if (!this.completed.has(depId) && !this.failed.has(depId)) {
        this.skipped.add(depId);
        this.running.delete(depId);
      }
    }

    return transitiveDependents.filter(id => this.skipped.has(id));
  }

  // ── Sorgulama ────────────────────────────────────────────

  /**
   * Tüm görevler sonuçlanmış mı kontrol eder.
   * Her görev tamamlandı, başarısız ya da atlandıysa true döner.
   */
  isComplete(): boolean {
    for (const id of this.tasks.keys()) {
      if (
        !this.completed.has(id) &&
        !this.failed.has(id) &&
        !this.skipped.has(id)
      ) {
        return false;
      }
    }
    return this.tasks.size > 0;
  }

  /**
   * Mevcut görev durumu sayaçlarını döndürür.
   */
  getStatus(): {
    completed: number;
    failed: number;
    skipped: number;
    running: number;
    pending: number;
  } {
    const total = this.tasks.size;
    const completedCount = this.completed.size;
    const failedCount = this.failed.size;
    const skippedCount = this.skipped.size;
    const runningCount = this.running.size;
    const pending = total - completedCount - failedCount - skippedCount - runningCount;

    return {
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      running: runningCount,
      pending,
    };
  }

  /**
   * Atlanan tüm görevlerin tanımlarını döndürür.
   */
  getSkippedTasks(): TaskDefinition[] {
    const result: TaskDefinition[] = [];
    for (const id of this.skipped) {
      const task = this.tasks.get(id);
      if (task) {
        result.push(task);
      }
    }
    return result;
  }

  // ── Dahili Yardımcılar ───────────────────────────────────

  /**
   * Verilen görevin tüm transitif bağımlılarını bulur (BFS).
   * Ters bağımlılık kenarları üzerinden dolaşarak
   * doğrudan ve dolaylı olarak bu göreve bağımlı tüm görevleri tespit eder.
   */
  private findTransitiveDependents(taskId: string): string[] {
    // Ters bağımlılık haritası oluştur: taskId → bu göreve bağımlı görevler
    const reverseDeps = new Map<string, string[]>();
    for (const [id, task] of this.tasks) {
      for (const dep of task.dependencies) {
        if (!reverseDeps.has(dep)) {
          reverseDeps.set(dep, []);
        }
        reverseDeps.get(dep)!.push(id);
      }
    }

    // BFS ile transitif bağımlıları bul
    const visited = new Set<string>();
    const queue: string[] = [taskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = reverseDeps.get(current) ?? [];

      for (const depId of dependents) {
        if (!visited.has(depId)) {
          visited.add(depId);
          queue.push(depId);
        }
      }
    }

    return [...visited];
  }
}
