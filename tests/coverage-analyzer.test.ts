import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoverageAnalyzer } from '../src/agent/tracer/coverage-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-coverage-test-' + Date.now());

async function setupWithRealCoverage(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });
  await mkdir(join(TEST_DIR, 'coverage'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, outDir: 'dist', rootDir: 'src' },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'math.ts'), `
export function add(a: number, b: number): number { return a + b; }
export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}
`);

  await writeFile(join(TEST_DIR, 'src', 'untested.ts'), `
export function riskyFunction(input: any): string {
  if (!input) return 'empty';
  if (input.type === 'a') {
    for (let i = 0; i < input.items.length; i++) {
      if (input.items[i].valid) return 'found';
    }
  }
  return 'default';
}
`);

  await writeFile(join(TEST_DIR, 'tests', 'math.test.ts'), `
import { add } from '../src/math.js';
import { test, expect } from 'vitest';
test('add', () => expect(add(1, 2)).toBe(3));
`);

  const coverageData = {
    [join(TEST_DIR, 'src', 'math.ts').replace(/\\/g, '/')]: {
      path: join(TEST_DIR, 'src', 'math.ts').replace(/\\/g, '/'),
      statementMap: { '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } }, '1': { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } } },
      fnMap: { '0': { name: 'add', decl: { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } }, loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } } }, '1': { name: 'divide', decl: { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } }, loc: { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } } } },
      branchMap: { '0': { type: 'if', loc: { start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }, locations: [{ start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }, { start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }] } },
      s: { '0': 5, '1': 3 },
      f: { '0': 5, '1': 3 },
      b: { '0': [1, 2] },
    },
  };

  await writeFile(join(TEST_DIR, 'coverage', 'coverage-final.json'), JSON.stringify(coverageData, null, 2));
}

async function setupHeuristicOnly(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, outDir: 'dist', rootDir: 'src' },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'tested.ts'), `export function hello() { return 'hi'; }`);
  await writeFile(join(TEST_DIR, 'src', 'untested.ts'), `export function lonely() { return 'alone'; }`);
  await writeFile(join(TEST_DIR, 'tests', 'tested.test.ts'), `import { hello } from '../src/tested.js';`);
}

describe('CoverageAnalyzer', () => {
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  describe('with real coverage data', () => {
    beforeEach(async () => { await setupWithRealCoverage(); });

    it('should parse Istanbul coverage-final.json', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.hasRealData).toBe(true);
      expect(report.files.length).toBeGreaterThan(0);
    });

    it('should report per-file coverage', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      const mathFile = report.files.find(f => f.file.includes('math.ts'));
      expect(mathFile).toBeDefined();
      expect(mathFile!.functions.covered).toBeGreaterThan(0);
    });
  });

  describe('heuristic fallback (no coverage JSON)', () => {
    beforeEach(async () => { await setupHeuristicOnly(); });

    it('should detect tested files via test file matching', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.hasRealData).toBe(false);
      expect(report.summary.coveredFiles).toBeGreaterThanOrEqual(1);
    });

    it('should detect untested source files', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      const untestedFile = report.files.find(f => f.file.includes('untested.ts'));
      expect(untestedFile).toBeDefined();
      expect(untestedFile!.functions.percent).toBe(0);
    });
  });

  describe('risk zones', () => {
    beforeEach(async () => { await setupWithRealCoverage(); });

    it('should produce risk zones array', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.riskZones).toBeDefined();
      expect(Array.isArray(report.riskZones)).toBe(true);
    });

    it('should update riskZoneCount in summary', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.summary.riskZoneCount).toBe(report.riskZones.length);
    });
  });
});
