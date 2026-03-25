import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeFlowAnalyzer } from '../src/agent/tracer/type-flow-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-typeflow-test-' + Date.now());

async function setupProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src', 'services'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'routes'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
      strict: true, outDir: 'dist', rootDir: 'src',
    },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'types.ts'), `
export interface User {
  id: number;
  name: string;
  email: string;
}
export interface Todo {
  id: number;
  title: string;
  userId: number;
}
export type Role = 'admin' | 'user';
`);

  await writeFile(join(TEST_DIR, 'src', 'services', 'user-service.ts'), `
import type { User, Role } from '../types.js';
export function getUser(id: number): User {
  return { id, name: 'Test', email: 'test@test.com' };
}
export function getRole(): Role { return 'user'; }
`);

  await writeFile(join(TEST_DIR, 'src', 'services', 'todo-service.ts'), `
import type { Todo, User } from '../types.js';
export function getTodos(user: User): Todo[] {
  return [{ id: 1, title: 'Test', userId: user.id }];
}
`);

  await writeFile(join(TEST_DIR, 'src', 'routes', 'user-route.ts'), `
import type { User } from '../types.js';
import { getUser } from '../services/user-service.js';
export function handleGetUser(id: number): User { return getUser(id); }
`);
}

describe('TypeFlowAnalyzer', () => {
  beforeEach(async () => { await setupProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('should detect all type declarations', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const names = report.typeNodes.map(t => t.name);
    expect(names).toContain('User');
    expect(names).toContain('Todo');
    expect(names).toContain('Role');
  });

  it('should identify User as hot type (used in 3+ files)', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const user = report.typeNodes.find(t => t.name === 'User');
    expect(user).toBeDefined();
    expect(user!.usageCount).toBeGreaterThanOrEqual(3);
    expect(report.hotTypes[0]?.name).toBe('User');
  });

  it('should build impact chains', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const userChain = report.impactChains.find(c => c.source.name === 'User');
    expect(userChain).toBeDefined();
    expect(userChain!.blastRadius).toBeGreaterThanOrEqual(3);
  });

  it('should calculate risk score between 0-100', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.riskScore).toBeLessThanOrEqual(100);
  });

  it('should provide summary stats', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.summary.totalTypes).toBeGreaterThanOrEqual(3);
    expect(report.summary.avgUsagePerType).toBeGreaterThan(0);
  });
});
