/**
 * Memory Layer Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryLayer } from '../src/memory/memory-layer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'pc-test-' + Date.now());

async function setupTestFiles(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  
  await writeFile(join(TEST_DIR, 'MISSION.md'), `# MISSION
## Neden Varız
Test mission
## Ne İnşa Ediyoruz
Test system
## Başarı Tanımı
Test success
`);

  await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), `# ARCHITECTURE
Test architecture
`);

  await writeFile(join(TEST_DIR, 'DECISIONS.md'), `# DECISIONS

## D001 — Test Decision
- **Tarih**: 2026-01-01
- **Karar**: Test
- **Durum**: active
`);

  await writeFile(join(TEST_DIR, 'STATE.md'), `# STATE

## Current Phase: \`initialization\`

## Iteration: 0

## Active Tasks
- [ ] T001 — Test task — agent: coder — status: pending

## Completed Tasks
_henüz yok_

## Blocked
_henüz yok_

## Last Updated: 2026-01-01T00:00:00Z
`);
}

describe('MemoryLayer', () => {
  let memory: MemoryLayer;

  beforeEach(async () => {
    await setupTestFiles();
    memory = new MemoryLayer(TEST_DIR);
  });

  it('should read all memory files', async () => {
    const files = await memory.readAll();
    expect(files.mission).toContain('## Neden Varız');
    expect(files.architecture).toContain('ARCHITECTURE');
    expect(files.decisions).toContain('D001');
    expect(files.state).toContain('initialization');
  });

  it('should take a snapshot with hash', async () => {
    const snapshot = await memory.snapshot();
    expect(snapshot.hash).toBeTruthy();
    expect(snapshot.hash.length).toBe(12);
    expect(snapshot.timestamp).toBeTruthy();
    expect(snapshot.files.mission).toContain('MISSION');
  });

  it('should validate mission integrity', async () => {
    const isValid = await memory.validateMissionIntegrity();
    expect(isValid).toBe(true);
  });

  it('should fail validation for incomplete mission', async () => {
    await writeFile(join(TEST_DIR, 'MISSION.md'), '# MISSION\nIncomplete');
    const memory2 = new MemoryLayer(TEST_DIR);
    const isValid = await memory2.validateMissionIntegrity();
    expect(isValid).toBe(false);
  });

  it('should count decisions', async () => {
    const count = await memory.getDecisionCount();
    expect(count).toBe(1);
  });

  it('should generate next decision ID', async () => {
    const nextId = await memory.getNextDecisionId();
    expect(nextId).toBe('D002');
  });

  it('should append a decision', async () => {
    await memory.appendDecision({
      id: 'D002',
      title: 'New Decision',
      date: '2026-01-02',
      context: 'Test context',
      decision: 'We decided X',
      rationale: 'Because Y',
      alternatives: 'Z was considered',
      status: 'active',
    });

    const content = await memory.readDecisions();
    expect(content).toContain('D002');
    expect(content).toContain('New Decision');
  });

  it('should parse state', async () => {
    const state = await memory.parseState();
    expect(state.phase).toBe('initialization');
    expect(state.iteration).toBe(0);
    expect(state.activeTasks.length).toBeGreaterThan(0);
  });

  it('should update state', async () => {
    await memory.updateState({
      phase: 'executing',
      iteration: 1,
      activeTasks: [
        { taskId: 'T001', title: 'Test', status: 'running', assignedAgent: 'coder' },
      ],
      completedTasks: [],
      blockedTasks: [],
      lastUpdated: new Date().toISOString(),
    });

    const updated = await memory.readState();
    expect(updated).toContain('executing');
    expect(updated).toContain('running');
  });
});
