/**
 * Dependency Graph — Topological Sort ile Task Sıralama
 * 
 * Task'lar arası bağımlılıkları yönetir.
 * Kahn's algorithm ile topological sort yapar.
 * Paralel çalışabilecek task'ları gruplayarak döndürür.
 */

import type { TaskDefinition } from '../types/index.js';

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
}
