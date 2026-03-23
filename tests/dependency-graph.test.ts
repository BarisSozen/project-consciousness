/**
 * DependencyGraph Tests
 */
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/orchestrator/dependency-graph.js';
import type { TaskDefinition } from '../src/types/index.js';

const task = (id: string, deps: string[] = []): TaskDefinition => ({
  id, title: id, description: '', type: 'code',
  dependencies: deps, priority: 'medium', estimatedComplexity: 'simple',
  acceptanceCriteria: [],
});

describe('DependencyGraph', () => {
  it('should return single group for independent tasks', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2'));
    g.addTask(task('T3'));
    expect(g.getExecutionOrder()).toEqual([['T1', 'T2', 'T3']]);
  });

  it('should order sequential dependencies', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2', ['T1']));
    g.addTask(task('T3', ['T2']));
    expect(g.getExecutionOrder()).toEqual([['T1'], ['T2'], ['T3']]);
  });

  it('should group parallel tasks with shared dependency', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2', ['T1']));
    g.addTask(task('T3', ['T1']));
    g.addTask(task('T4', ['T2', 'T3']));
    expect(g.getExecutionOrder()).toEqual([['T1'], ['T2', 'T3'], ['T4']]);
  });

  it('should detect cycle', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1', ['T2']));
    g.addTask(task('T2', ['T1']));
    expect(g.hasCycle()).toBe(true);
  });

  it('should throw on getExecutionOrder with cycle', () => {
    const g = new DependencyGraph();
    g.addTask(task('A', ['B']));
    g.addTask(task('B', ['A']));
    expect(() => g.getExecutionOrder()).toThrow('cycle');
  });

  it('should return ready tasks based on completed set', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2', ['T1']));
    g.addTask(task('T3', ['T1']));

    expect(g.getReadyTasks(new Set())).toEqual(['T1']);
    expect(g.getReadyTasks(new Set(['T1']))).toEqual(['T2', 'T3']);
    expect(g.getReadyTasks(new Set(['T1', 'T2', 'T3']))).toEqual([]);
  });

  it('should report size', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2'));
    expect(g.size).toBe(2);
  });

  it('should get dependencies and dependents', () => {
    const g = new DependencyGraph();
    g.addTask(task('T1'));
    g.addTask(task('T2', ['T1']));
    expect(g.getDependencies('T2')).toEqual(['T1']);
    expect(g.getDependents('T1')).toEqual(['T2']);
  });
});
