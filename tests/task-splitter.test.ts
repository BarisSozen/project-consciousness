import { describe, it, expect } from 'vitest';
import { TaskSplitter } from '../src/orchestrator/task-splitter.js';
import type { TaskDefinition } from '../src/types/index.js';

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'T001',
    title: 'Build User CRUD API',
    description: 'Create a full CRUD API for User entity with model, service, route, and tests',
    type: 'code',
    dependencies: [],
    priority: 'high',
    estimatedComplexity: 'moderate',
    acceptanceCriteria: [
      'User model with id, name, email fields',
      'Service with getUser, createUser, updateUser, deleteUser',
      'REST route with GET/POST/PUT/DELETE endpoints',
      'Unit tests for all service functions',
    ],
    ...overrides,
  };
}

describe('TaskSplitter', () => {
  const splitter = new TaskSplitter();

  it('should not split small tasks', () => {
    const small = makeTask({
      title: 'Add email field to User',
      description: 'Add email field to User interface',
      acceptanceCriteria: ['email field exists'],
    });

    const result = splitter.split(small);
    expect(result.wasSplit).toBe(false);
    expect(result.original).toBeDefined();
  });

  it('should split CRUD tasks into sub-tasks', () => {
    const crud = makeTask();
    const result = splitter.split(crud);

    expect(result.wasSplit).toBe(true);
    expect(result.subTasks.length).toBeGreaterThanOrEqual(2);
    expect(result.reason).toContain('split into');
  });

  it('should set dependencies between sub-tasks', () => {
    const crud = makeTask();
    const result = splitter.split(crud);

    if (result.subTasks.length >= 2) {
      // Second sub-task should depend on first
      expect(result.subTasks[1]!.dependencies).toContain(result.subTasks[0]!.id);
    }
  });

  it('should include layer guidance in sub-task descriptions', () => {
    const crud = makeTask();
    const result = splitter.split(crud);

    if (result.wasSplit) {
      const firstSubTask = result.subTasks[0]!;
      expect(firstSubTask.description).toContain('Focus:');
    }
  });

  it('should inject handoff context into sub-task descriptions', () => {
    const crud = makeTask();
    const handoff = '## Built Artifacts\n\n### src/models/user.ts\nTypes: interface User { id: number; name: string }';

    const result = splitter.split(crud, handoff);

    if (result.wasSplit) {
      const lastSubTask = result.subTasks[result.subTasks.length - 1]!;
      expect(lastSubTask.description).toContain('Already Built');
    }
  });

  it('should inject handoff into non-split tasks too', () => {
    const small = makeTask({
      title: 'Add email validation',
      description: 'Add Zod validation to email field',
      acceptanceCriteria: ['email validated with Zod'],
    });

    const handoff = '### src/models/user.ts\nExports: User';
    const result = splitter.split(small, handoff);

    expect(result.wasSplit).toBe(false);
    expect(result.original!.description).toContain('Already Built');
  });

  it('should assign sub-task IDs as parent.idx', () => {
    const crud = makeTask({ id: 'T003' });
    const result = splitter.split(crud);

    if (result.wasSplit) {
      expect(result.subTasks[0]!.id).toBe('T003.1');
      expect(result.subTasks[1]!.id).toBe('T003.2');
    }
  });

  it('should handle multi-entity tasks', () => {
    const multi = makeTask({
      title: 'Build User and Todo CRUD',
      description: 'Create CRUD APIs for User and Todo entities with models, services, routes, and tests',
      acceptanceCriteria: ['User CRUD', 'Todo CRUD', 'Tests for both'],
    });

    const result = splitter.split(multi);
    expect(result.wasSplit).toBe(true);
    expect(result.subTasks.length).toBeGreaterThanOrEqual(2);
  });
});
