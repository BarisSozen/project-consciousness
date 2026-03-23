/**
 * Agent Runner Integration Tests
 * 
 * ProcessSpawner ile entegrasyon — claude binary mock'lanır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunner } from '../src/agent/agent-runner.js';
import { ProcessSpawner } from '../src/agent/process-spawner.js';
import type { TaskDefinition, MemorySnapshot } from '../src/types/index.js';

// ProcessSpawner'ı mock'la
vi.mock('../src/agent/process-spawner.js', () => {
  return {
    ProcessSpawner: vi.fn().mockImplementation(() => ({
      spawn: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: `## Sonuç
[BAŞARILI]

## Yapılanlar
- Implemented the feature

## Oluşturulan/Değiştirilen Dosyalar
- src/feature.ts — new file

## Kabul Kriterleri Kontrolü
- [x] 1. Feature works
- [x] 2. Tests pass

## Notlar
All done.`,
        stderr: '',
        duration: 5000,
        timedOut: false,
      }),
      healthCheck: vi.fn().mockResolvedValue({
        available: true,
        version: '1.0.0-test',
      }),
    })),
  };
});

const mockMemory: MemorySnapshot = {
  files: {
    mission: '# MISSION\n## Neden Varız\nTest\n## Ne İnşa Ediyoruz\nTest\n## Başarı Tanımı\nTest',
    architecture: '# ARCHITECTURE\nTest arch',
    decisions: '# DECISIONS\n## D001 — Test\nTest decision',
    state: '# STATE\n## Current Phase: `executing`\n## Iteration: 1',
  },
  timestamp: '2026-01-01T00:00:00Z',
  hash: 'test123',
};

const mockTask: TaskDefinition = {
  id: 'T001',
  title: 'Test task',
  description: 'A test task',
  type: 'code',
  dependencies: [],
  priority: 'medium',
  estimatedComplexity: 'simple',
  acceptanceCriteria: ['Feature works', 'Tests pass'],
};

describe('AgentRunner', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    runner = new AgentRunner({
      workingDirectory: '/tmp/test',
      timeout: 30_000,
      log: () => {}, // silent in tests
    });
  });

  it('should check health correctly', async () => {
    const health = await runner.checkHealth();
    expect(health.ready).toBe(true);
    expect(health.details).toContain('1.0.0-test');
  });

  it('should register default agents', () => {
    expect(runner.getAgent('coder')).toBeDefined();
    expect(runner.getAgent('reviewer')).toBeDefined();
    expect(runner.getAgent('tester')).toBeDefined();
    expect(runner.getAgent('documenter')).toBeDefined();
  });

  it('should run a task and return result', async () => {
    const result = await runner.runTask(mockTask, mockMemory);
    
    expect(result.taskId).toBe('T001');
    expect(result.agentId).toBe('coder');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Status: success');
    expect(result.artifacts).toContain('src/feature.ts');
  });

  it('should select correct agent by task type', async () => {
    const reviewTask: TaskDefinition = {
      ...mockTask,
      id: 'T002',
      type: 'review',
    };

    const result = await runner.runTask(reviewTask, mockMemory);
    expect(result.agentId).toBe('reviewer');
  });

  it('should respect explicit agent assignment', async () => {
    const taskWithAgent: TaskDefinition = {
      ...mockTask,
      id: 'T003',
      agent: 'documenter',
    };

    const result = await runner.runTask(taskWithAgent, mockMemory);
    expect(result.agentId).toBe('documenter');
  });

  it('should run parallel tasks in batches', async () => {
    const tasks = [
      { ...mockTask, id: 'T010' },
      { ...mockTask, id: 'T011' },
      { ...mockTask, id: 'T012' },
    ];

    const results = await runner.runParallel(tasks, mockMemory, 2);
    
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should fail gracefully for unknown agent type', async () => {
    const weirdTask: TaskDefinition = {
      ...mockTask,
      id: 'T099',
      agent: 'nonexistent-agent',
    };

    const result = await runner.runTask(weirdTask, mockMemory);
    expect(result.success).toBe(false);
    expect(result.output).toContain('No agent found');
  });
});

describe('AgentRunner depth protection', () => {
  it('should reject when max depth exceeded', async () => {
    // Simulate deep nesting
    const originalDepth = process.env['PC_AGENT_DEPTH'];
    process.env['PC_AGENT_DEPTH'] = '5';

    const runner = new AgentRunner({
      workingDirectory: '/tmp/test',
      maxDepth: 3,
      log: () => {},
    });

    const health = await runner.checkHealth();
    expect(health.ready).toBe(false);
    expect(health.details).toContain('Max agent depth');

    // Cleanup
    if (originalDepth !== undefined) {
      process.env['PC_AGENT_DEPTH'] = originalDepth;
    } else {
      delete process.env['PC_AGENT_DEPTH'];
    }
  });
});
