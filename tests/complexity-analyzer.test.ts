import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComplexityAnalyzer } from '../src/agent/tracer/complexity-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-complexity-test-' + Date.now());

async function setupProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
      strict: true, outDir: 'dist', rootDir: 'src',
    },
    include: ['src'],
  }));

  // Simple function — low complexity
  await writeFile(join(TEST_DIR, 'src', 'simple.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}
`);

  // Complex function — high cyclomatic + cognitive
  await writeFile(join(TEST_DIR, 'src', 'complex.ts'), `
export function processOrder(order: any, user: any): string {
  if (!order) return 'invalid';
  if (!user) return 'no-user';

  let status = 'pending';

  if (order.type === 'express') {
    if (user.isPremium) {
      status = 'priority';
    } else if (user.orders > 10) {
      status = 'loyalty';
    } else {
      status = 'standard';
    }
  } else if (order.type === 'bulk') {
    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].quantity > 100) {
        status = 'warehouse';
        break;
      }
    }
  }

  switch (order.payment) {
    case 'card': status += '-card'; break;
    case 'bank': status += '-bank'; break;
    case 'crypto': status += '-crypto'; break;
    default: status += '-other';
  }

  return status;
}

export function simpleHelper(): boolean { return true; }
`);
}

describe('ComplexityAnalyzer', () => {
  beforeEach(async () => { await setupProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('should rate simple functions as ok', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const addFn = report.functions.find(f => f.name === 'add');
    expect(addFn).toBeDefined();
    expect(addFn!.cyclomatic).toBe(1);
    expect(addFn!.rating).toBe('ok');
  });

  it('should detect high complexity in processOrder', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const processFn = report.functions.find(f => f.name === 'processOrder');
    expect(processFn).toBeDefined();
    expect(processFn!.cyclomatic).toBeGreaterThan(8);
    expect(['warning', 'critical']).toContain(processFn!.rating);
  });

  it('should list hotspots sorted by complexity', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.hotspots.length).toBeGreaterThan(0);
    expect(report.hotspots[0]!.name).toBe('processOrder');
  });

  it('should provide per-file aggregates', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const complexFile = report.files.find(f => f.file.includes('complex.ts'));
    expect(complexFile).toBeDefined();
    expect(complexFile!.totalFunctions).toBe(2);
    expect(complexFile!.maxCyclomatic).toBeGreaterThan(1);
  });

  it('should calculate summary counts', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.totalFunctions).toBeGreaterThanOrEqual(3);
    expect(report.summary.ok).toBeGreaterThanOrEqual(1);
  });
});
