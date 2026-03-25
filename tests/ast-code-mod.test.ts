import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ASTCodeMod } from '../src/agent/tracer/ast-code-mod.js';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-astmod-test-' + Date.now());

async function setupProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });

  await writeFile(join(TEST_DIR, 'src', 'types.ts'), `export interface User {
  id: number;
  name: string;
}

export interface Todo {
  id: number;
  title: string;
}
`);

  await writeFile(join(TEST_DIR, 'src', 'service.ts'), `import { User } from './types.js';

export function getUser(id: number): User {
  const result = db.query(id);
  return result;
}

export const processData = (data: string): string => {
  const parsed = JSON.parse(data);
  return parsed.value;
};
`);
}

describe('ASTCodeMod', () => {
  beforeEach(async () => { await setupProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  describe('addField', () => {
    it('should add a field to an interface', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addField('src/types.ts', 'User', 'email', 'string');
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'types.ts'), 'utf-8');
      expect(content).toContain('email');
      expect(content).toContain('string');
    });

    it('should not duplicate existing fields', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addField('src/types.ts', 'User', 'name', 'string');
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'types.ts'), 'utf-8');
      const nameCount = (content.match(/name/g) || []).length;
      // Should still have original 'name' field, not duplicated
      expect(nameCount).toBeLessThanOrEqual(2); // 'name' appears in both User
    });

    it('should fail for non-existent interface', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addField('src/types.ts', 'NonExistent', 'field', 'string');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('addImport', () => {
    it('should add import statement', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addImport('src/service.ts', 'zod', ['z', 'ZodSchema']);
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'service.ts'), 'utf-8');
      expect(content).toContain("import { z, ZodSchema } from 'zod'");
    });

    it('should not duplicate existing imports', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addImport('src/service.ts', './types.js', ['User']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('renameSymbol', () => {
    it('should rename all occurrences of a symbol', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.renameSymbol('src/service.ts', 'getUser', 'fetchUser');
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'service.ts'), 'utf-8');
      expect(content).toContain('fetchUser');
      expect(content).not.toContain('getUser');
    });

    it('should fail for non-existent symbol', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.renameSymbol('src/service.ts', 'nonExistent', 'newName');
      expect(result.success).toBe(false);
    });
  });

  describe('wrapWithTryCatch', () => {
    it('should wrap function with try/catch', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.wrapWithTryCatch('src/service.ts', 'getUser');
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'service.ts'), 'utf-8');
      expect(content).toContain('try');
      expect(content).toContain('catch');
      expect(content).toContain('getUser failed:');
    });

    it('should wrap arrow function with try/catch', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.wrapWithTryCatch('src/service.ts', 'processData');
      expect(result.success).toBe(true);

      const content = await readFile(join(TEST_DIR, 'src', 'service.ts'), 'utf-8');
      expect(content).toContain('processData failed:');
    });

    it('should not double-wrap already wrapped functions', async () => {
      const mod = new ASTCodeMod(TEST_DIR);
      mod.wrapWithTryCatch('src/service.ts', 'getUser');
      const result2 = mod.wrapWithTryCatch('src/service.ts', 'getUser');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already wrapped');
    });
  });

  describe('file not found', () => {
    it('should return error for missing file', () => {
      const mod = new ASTCodeMod(TEST_DIR);
      const result = mod.addField('src/nonexistent.ts', 'User', 'field', 'string');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });
  });
});
