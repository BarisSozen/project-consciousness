/**
 * Memory Optimization Tests — summarizeDecisions + compressState + optimizedSnapshot
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MemoryLayer } from '../src/memory/memory-layer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `pc-memopt-${Date.now()}`);

function makeDecisions(count: number): string {
  let content = `# DECISIONS\n\n> Append-only log.\n`;
  for (let i = 1; i <= count; i++) {
    const id = `D${String(i).padStart(3, '0')}`;
    content += `
---

## ${id} — Decision ${i} title

- **Tarih**: 2026-01-${String(i).padStart(2, '0')}
- **Bağlam**: Context for decision ${i}
- **Karar**: What was decided ${i}
- **Gerekçe**: Why ${i}
- **Alternatifler**: Alt ${i}
- **Durum**: active
`;
  }
  return content;
}

function makeState(completedCount: number): string {
  const completed = Array.from({ length: completedCount }, (_, i) =>
    `- [x] T${String(i + 1).padStart(3, '0')} — Task ${i + 1} — done`
  ).join('\n');

  return `# STATE — Project Consciousness

## Current Phase: \`executing\`

## Iteration: ${completedCount}

## Active Tasks
- [ ] T999 — Current task — status: running

## Completed Tasks
${completed}

## Blocked
_henüz yok_

## Last Updated: 2026-03-24T00:00:00Z
`;
}

async function setup(decisions: number, completed: number): Promise<void> {
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(TEST_DIR, { recursive: true });
  await writeFile(join(TEST_DIR, 'MISSION.md'), '# MISSION\n## Neden Varız\nTest\n## Ne İnşa Ediyoruz\nTest\n## Başarı Tanımı\nTest');
  await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), '# ARCHITECTURE\nTest');
  await writeFile(join(TEST_DIR, 'DECISIONS.md'), makeDecisions(decisions));
  await writeFile(join(TEST_DIR, 'STATE.md'), makeState(completed));
}

describe('Memory Optimization', () => {
  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('summarizeDecisions', () => {
    it('should return raw when decisions <= recentCount', async () => {
      await setup(5, 0);
      const memory = new MemoryLayer(TEST_DIR);
      const raw = await memory.readDecisions();
      const result = memory.summarizeDecisions(raw, 10);
      expect(result).toBe(raw); // no change
    });

    it('should summarize old decisions when count > recentCount', async () => {
      await setup(16, 0);
      const memory = new MemoryLayer(TEST_DIR);
      const raw = await memory.readDecisions();
      const result = memory.summarizeDecisions(raw, 10);

      // Should be shorter than raw
      expect(result.length).toBeLessThan(raw.length);

      // Should contain summary header
      expect(result).toContain('eski karar özetlendi');
      expect(result).toContain('son 10 tam gösteriliyor');

      // Should contain summarized old decisions
      expect(result).toContain('D001');
      expect(result).toContain('Decision 1 title');

      // Should contain recent decisions in full
      expect(result).toContain('## D016');
      expect(result).toContain('## D007'); // first recent (16-10+1=7)
      expect(result).toContain('Context for decision 16');
    });

    it('should group summaries in chunks of 5', async () => {
      await setup(20, 0);
      const memory = new MemoryLayer(TEST_DIR);
      const raw = await memory.readDecisions();
      const result = memory.summarizeDecisions(raw, 10);

      // 10 old decisions → 2 groups of 5
      expect(result).toContain('**D001-D005**');
      expect(result).toContain('**D006-D010**');
    });
  });

  describe('compressState', () => {
    it('should return raw when completed <= max', async () => {
      await setup(0, 3);
      const memory = new MemoryLayer(TEST_DIR);
      const raw = await memory.readState();
      const result = memory.compressState(raw, 5);
      expect(result).toBe(raw); // no change
    });

    it('should compress when completed > max', async () => {
      await setup(0, 12);
      const memory = new MemoryLayer(TEST_DIR);
      const raw = await memory.readState();
      const result = memory.compressState(raw, 5);

      // Should be shorter
      expect(result.length).toBeLessThan(raw.length);

      // Should mention total count
      expect(result).toContain('12 task tamamlandı');
      expect(result).toContain('son 5 gösteriliyor');

      // Should show only last 5
      expect(result).toContain('T012');
      expect(result).toContain('T008');
      expect(result).not.toContain('T001 — Task 1');
      expect(result).not.toContain('T007 — Task 7');

      // Active tasks preserved
      expect(result).toContain('T999');
    });
  });

  describe('optimizedSnapshot', () => {
    it('should return optimized files in snapshot', async () => {
      await setup(16, 12);
      const memory = new MemoryLayer(TEST_DIR);
      
      const regular = await memory.snapshot();
      const optimized = await memory.optimizedSnapshot(10, 5);

      // Optimized should be smaller
      const regSize = Object.values(regular.files).join('').length;
      const optSize = Object.values(optimized.files).join('').length;
      expect(optSize).toBeLessThan(regSize);

      // Mission and architecture should be identical
      expect(optimized.files.mission).toBe(regular.files.mission);
      expect(optimized.files.architecture).toBe(regular.files.architecture);

      // Decisions should be summarized
      expect(optimized.files.decisions).toContain('eski karar özetlendi');

      // State should be compressed
      expect(optimized.files.state).toContain('12 task tamamlandı');

      // Hash should differ
      expect(optimized.hash).not.toBe(regular.hash);
    });

    it('should not change anything when content is small', async () => {
      await setup(3, 2);
      const memory = new MemoryLayer(TEST_DIR);

      const regular = await memory.snapshot();
      const optimized = await memory.optimizedSnapshot();

      // Same content — nothing to compress
      expect(optimized.files.decisions).toBe(regular.files.decisions);
      expect(optimized.files.state).toBe(regular.files.state);
    });
  });

  describe('size reduction', () => {
    it('should achieve significant reduction for large memory', async () => {
      await setup(50, 30);
      const memory = new MemoryLayer(TEST_DIR);

      const regular = await memory.snapshot();
      const optimized = await memory.optimizedSnapshot(10, 5);

      const regSize = Object.values(regular.files).join('').length;
      const optSize = Object.values(optimized.files).join('').length;
      const reduction = ((regSize - optSize) / regSize) * 100;

      console.log(`  📊 Regular: ${regSize} chars`);
      console.log(`  📊 Optimized: ${optSize} chars`);
      console.log(`  📊 Reduction: ${reduction.toFixed(1)}%`);

      // At least 40% reduction for 50 decisions + 30 tasks
      expect(reduction).toBeGreaterThan(40);
    });
  });
});
