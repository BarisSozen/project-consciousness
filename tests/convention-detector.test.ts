import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConventionDetector } from '../src/agent/tracer/convention-detector.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-convention-test-' + Date.now());

async function setupCamelCaseProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src', 'services'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'routes'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });

  await writeFile(join(TEST_DIR, 'package.json'), JSON.stringify({
    name: 'test-project',
    dependencies: { express: '^5.0.0', zod: '^3.0.0' },
    devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
  }));

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'services', 'user-service.ts'), `
import { z } from 'zod';

const userSchema = z.object({ name: z.string(), email: z.string() });

export async function getUserById(id: number): Promise<User> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!result) throw new Error('User not found');
  return result;
}

export async function createUser(data: unknown): Promise<User> {
  const parsed = userSchema.parse(data);
  return db.insert('users', parsed);
}
`);

  await writeFile(join(TEST_DIR, 'src', 'routes', 'user-route.ts'), `
import { Router } from 'express';
import { getUserById, createUser } from '../services/user-service.js';

export const userRouter = Router();

userRouter.get('/:id', async (req, res) => {
  const user = await getUserById(Number(req.params.id));
  res.json(user);
});
`);

  await writeFile(join(TEST_DIR, 'src', 'services', 'index.ts'), `
export { getUserById, createUser } from './user-service.js';
export { getTodos } from './todo-service.js';
export { processOrder } from './order-service.js';
`);

  await writeFile(join(TEST_DIR, 'tests', 'user-service.test.ts'), `
import { describe, it, expect } from 'vitest';

describe('UserService', () => {
  it('should get user by id', () => {
    expect(true).toBe(true);
  });
});
`);
}

describe('ConventionDetector', () => {
  beforeEach(async () => { await setupCamelCaseProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('should detect camelCase variable naming', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.variableNaming).toBe('camelCase');
  });

  it('should detect named import style', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.importStyle).toBe('named');
  });

  it('should detect zod validation lib', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.validationLib).toBe('zod');
  });

  it('should detect async-await pattern', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.asyncPattern).toBe('async-await');
  });

  it('should detect throw error handling', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.errorHandling).toBe('throw');
  });

  it('should detect vitest test framework', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.testFramework).toBe('vitest');
  });

  it('should detect describe-it test pattern', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.testPattern).toBe('describe-it');
  });

  it('should detect barrel exports', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.usesBarrelExports).toBe(true);
  });

  it('should detect architectural layers', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.layers).toContain('services');
    expect(report.conventions.layers).toContain('routes');
  });

  it('should detect single quotes', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.quotes).toBe('single');
  });

  it('should generate prompt snippet', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.promptSnippet).toContain('Project Conventions');
    expect(report.promptSnippet).toContain('zod');
    expect(report.promptSnippet).toContain('async-await');
  });

  it('should have confidence > 0', async () => {
    const detector = new ConventionDetector(TEST_DIR);
    const report = await detector.detect();
    expect(report.conventions.confidence).toBeGreaterThan(0);
  });
});
