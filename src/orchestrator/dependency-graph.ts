/**
 * Dependency Graph — Topological Sort ile Task Sıralama
 * 
 * Task'lar arası bağımlılıkları yönetir.
 * Kahn's algorithm ile topological sort yapar.
 * Paralel çalışabilecek task'ları gruplayarak döndürür.
 */

import type { TaskDefinition, CriticalPathInfo } from '../types/index.js';

export class DependencyGraph {
  private tasks: Map<string, TaskDefinition> = new Map();
  private edges: Map<string, Set<string>> = new Map();      // taskId → depends on
  private reverseEdges: Map<string, Set<string>> = new Map(); // taskId → depended by

  // ── Build ───────────────────────────────────────────────

  addTask(task: TaskDefinition): void {
    this.tasks.set(task.id, task);
    if (!this.edges.has(task.id)) {
      this.edges.set(task.id, new Set());
    }
    if (!this.reverseEdges.has(task.id)) {
      this.reverseEdges.set(task.id, new Set());
    }

    // Task'ın kendi dependency'lerini ekle
    for (const dep of task.dependencies) {
      this.addDependency(task.id, dep);
    }
  }

  addDependency(taskId: string, dependsOnId: string): void {
    if (!this.edges.has(taskId)) this.edges.set(taskId, new Set());
    if (!this.edges.has(dependsOnId)) this.edges.set(dependsOnId, new Set());
    if (!this.reverseEdges.has(taskId)) this.reverseEdges.set(taskId, new Set());
    if (!this.reverseEdges.has(dependsOnId)) this.reverseEdges.set(dependsOnId, new Set());

    this.edges.get(taskId)!.add(dependsOnId);
    this.reverseEdges.get(dependsOnId)!.add(taskId);
  }

  // ── Query ───────────────────────────────────────────────

  /**
   * Topological sort → paralel gruplar.
   * [[T01, T02], [T03], [T04, T05]]
   * → T01+T02 paralel, sonra T03, sonra T04+T05 paralel
   */
  getExecutionOrder(): string[][] {
    if (this.hasCycle()) {
      throw new Error('Dependency graph has a cycle — cannot determine execution order');
    }

    const inDegree = new Map<string, number>();
    for (const id of this.edges.keys()) {
      inDegree.set(id, this.edges.get(id)!.size);
    }

    const groups: string[][] = [];
    const completed = new Set<string>();

    while (completed.size < this.edges.size) {
      // Bu turda çalışabilecek task'lar (in-degree = 0, henüz tamamlanmamış)
      const ready: string[] = [];
      for (const [id, degree] of inDegree) {
        if (degree === 0 && !completed.has(id)) {
          ready.push(id);
        }
      }

      if (ready.length === 0) {
        break; // döngü olmamalı (hasCycle kontrol edildi) ama safety
      }

      groups.push(ready.sort()); // deterministic sıra

      // Tamamlanan task'ların bağımlılarının in-degree'sini düşür
      for (const id of ready) {
        completed.add(id);
        for (const dependent of this.reverseEdges.get(id) ?? []) {
          const current = inDegree.get(dependent) ?? 0;
          inDegree.set(dependent, current - 1);
        }
      }
    }

    return groups;
  }

  /**
   * Döngü tespiti (DFS-based)
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): boolean => {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      inStack.add(node);

      for (const dep of this.edges.get(node) ?? []) {
        if (dfs(dep)) return true;
      }

      inStack.delete(node);
      return false;
    };

    for (const id of this.edges.keys()) {
      if (dfs(id)) return true;
    }

    return false;
  }

  /**
   * Bağımlılıkları tamamlanmış, çalışmaya hazır task'lar
   */
  getReadyTasks(completedTaskIds: Set<string>): string[] {
    const ready: string[] = [];
    for (const [id, deps] of this.edges) {
      if (completedTaskIds.has(id)) continue;
      const allDepsMet = [...deps].every(d => completedTaskIds.has(d));
      if (allDepsMet) {
        ready.push(id);
      }
    }
    return ready.sort();
  }

  /**
   * Bir task'ın doğrudan bağımlılıkları
   */
  getDependencies(taskId: string): string[] {
    return [...(this.edges.get(taskId) ?? [])];
  }

  /**
   * Bir task'a bağımlı olan task'lar
   */
  getDependents(taskId: string): string[] {
    return [...(this.reverseEdges.get(taskId) ?? [])];
  }

  get size(): number {
    return this.tasks.size;
  }

  // ── Critical Path Analysis ─────────────────────────────────

  /**
   * Task'ın estimatedComplexity değerine göre tahmini süre (saniye).
   */
  getTaskDuration(taskId: string): number {
    const durationMap: Record<string, number> = {
      trivial: 30,
      simple: 60,
      moderate: 120,
      complex: 240,
    };
    const task = this.tasks.get(taskId);
    if (!task) return 60; // bilinmeyen task → simple varsayımı
    return durationMap[task.estimatedComplexity] ?? 60;
  }

  /**
   * En çok dependent'a sahip task'ı döndürür (bottleneck).
   * Graf boşsa null döner.
   */
  findBottleneck(): string | null {
    if (this.reverseEdges.size === 0) return null;

    let maxCount = 0;
    let bottleneck: string | null = null;

    for (const [taskId, dependents] of this.reverseEdges) {
      if (dependents.size > maxCount) {
        maxCount = dependents.size;
        bottleneck = taskId;
      }
    }

    return bottleneck;
  }

  /**
   * Critical Path hesapla — en uzun bağımlılık zinciri.
   * Complexity → duration mapping ile tahmini süre verir.
   */
  computeCriticalPath(): CriticalPathInfo {
    if (this.tasks.size === 0) {
      return { criticalPath: [], estimatedDuration: 0, parallelizableCount: 0, bottleneck: null };
    }

    // DP: her task için en uzun yol süresi (root'tan kendisine)
    const longestDuration = new Map<string, number>();
    // Her task için critical path üzerinde bir önceki task (backtrack için)
    const predecessor = new Map<string, string | null>();

    /**
     * Memoized DFS — taskId'nin root'tan kendisine en uzun yol süresini hesaplar.
     */
    const computeLongest = (taskId: string): number => {
      if (longestDuration.has(taskId)) return longestDuration.get(taskId)!;

      const deps = this.edges.get(taskId) ?? new Set<string>();
      const ownDuration = this.getTaskDuration(taskId);

      if (deps.size === 0) {
        // Root node — bağımlılığı yok
        longestDuration.set(taskId, ownDuration);
        predecessor.set(taskId, null);
        return ownDuration;
      }

      let maxDepDuration = 0;
      let maxDepId: string | null = null;

      for (const depId of deps) {
        const depDuration = computeLongest(depId);
        if (depDuration > maxDepDuration) {
          maxDepDuration = depDuration;
          maxDepId = depId;
        }
      }

      const total = ownDuration + maxDepDuration;
      longestDuration.set(taskId, total);
      predecessor.set(taskId, maxDepId);
      return total;
    };

    // Tüm task'lar için en uzun yol hesapla
    for (const taskId of this.edges.keys()) {
      computeLongest(taskId);
    }

    // En uzun toplam süreye sahip task'ı bul (critical path sonu)
    let maxDuration = 0;
    let criticalEnd: string | null = null;

    for (const [taskId, duration] of longestDuration) {
      if (duration > maxDuration) {
        maxDuration = duration;
        criticalEnd = taskId;
      }
    }

    // Critical path'i backtrack ile oluştur (sondan başa)
    const pathReversed: string[] = [];
    let current = criticalEnd;
    while (current !== null) {
      pathReversed.push(current);
      current = predecessor.get(current) ?? null;
    }
    const criticalPath = pathReversed.reverse();

    // Paralel çalışabilecek task sayısı = toplam - critical path üzerindeki
    const criticalSet = new Set(criticalPath);
    const totalTasks = this.edges.size;
    const parallelizableCount = totalTasks - criticalSet.size;

    return {
      criticalPath,
      estimatedDuration: maxDuration,
      parallelizableCount,
      bottleneck: this.findBottleneck(),
    };
  }
}
