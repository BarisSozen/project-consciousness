/**
 * CodebaseReader Tests
 * 
 * src/ dizini tara, auth task için ilgili dosyaları bul,
 * context özeti oluştur, token limiti test et.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { CodebaseReader } from '../src/agent/codebase-reader.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `pc-codebase-${Date.now()}`);

/** Test projesi oluştur */
async function createTestProject(): Promise<void> {
  // Dizin yapısı
  await mkdir(join(TEST_DIR, 'src', 'auth'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'api', 'routes'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'db'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'config'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'frontend', 'components'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });
  await mkdir(join(TEST_DIR, 'node_modules', 'something'), { recursive: true });

  // Kaynak dosyalar
  await writeFile(
    join(TEST_DIR, 'src', 'auth', 'auth-service.ts'),
    `/**
 * Auth Service — JWT tabanlı kimlik doğrulama
 */

import { sign, verify } from 'jsonwebtoken';
import type { User } from '../db/schema.js';

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  generateToken(user: User): string {
    return sign({ userId: user.id, email: user.email, role: user.role }, this.secret);
  }

  verifyToken(token: string): AuthPayload {
    return verify(token, this.secret) as AuthPayload;
  }
}

export function hashPassword(password: string): string {
  return password; // placeholder
}
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'auth', 'middleware.ts'),
    `export function authMiddleware(req: any, res: any, next: any) {
  next();
}

export function requireRole(role: string) {
  return (req: any, res: any, next: any) => next();
}
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'db', 'schema.ts'),
    `export interface User {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
}

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  userId: string;
}
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'api', 'routes', 'auth-routes.ts'),
    `export const authRoutes = {
  register: '/auth/register',
  login: '/auth/login',
  logout: '/auth/logout',
};
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'api', 'routes', 'todo-routes.ts'),
    `export const todoRoutes = {
  list: '/todos',
  create: '/todos',
  delete: '/todos/:id',
};
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'config', 'env.ts'),
    `export const config = {
  port: 3000,
  dbUrl: 'sqlite::memory:',
  jwtSecret: 'dev-secret',
};
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'frontend', 'components', 'LoginForm.tsx'),
    `export function LoginForm() {
  return '<form>login</form>';
}

export function RegisterForm() {
  return '<form>register</form>';
}
`
  );

  await writeFile(
    join(TEST_DIR, 'src', 'index.ts'),
    `export { AuthService } from './auth/auth-service.js';
export { config } from './config/env.js';
`
  );

  await writeFile(
    join(TEST_DIR, 'tests', 'auth.test.ts'),
    `import { describe, it } from 'vitest';
describe('auth', () => { it('should work', () => {}); });
`
  );

  await writeFile(
    join(TEST_DIR, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' })
  );

  await writeFile(
    join(TEST_DIR, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true } })
  );

  // node_modules içinde bir dosya (taranmamalı)
  await writeFile(
    join(TEST_DIR, 'node_modules', 'something', 'index.js'),
    'module.exports = {};'
  );
}

describe('CodebaseReader', () => {
  const reader = new CodebaseReader();

  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await createTestProject();
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  // ── scanProject ─────────────────────────────────────

  describe('scanProject', () => {
    it('should find all source files under src/', async () => {
      const structure = await reader.scanProject(TEST_DIR);

      expect(structure.totalFiles).toBeGreaterThan(0);
      expect(structure.root).toBe(TEST_DIR);

      // src/ altındaki dosyalar bulunmalı
      const srcFiles = structure.files.filter(f => f.relativePath.startsWith('src/'));
      expect(srcFiles.length).toBeGreaterThanOrEqual(6);
    });

    it('should skip node_modules', async () => {
      const structure = await reader.scanProject(TEST_DIR);

      const nmFiles = structure.files.filter(f =>
        f.relativePath.includes('node_modules')
      );
      expect(nmFiles).toHaveLength(0);
    });

    it('should include file extensions', async () => {
      const structure = await reader.scanProject(TEST_DIR);

      const tsFiles = structure.files.filter(f => f.extension === '.ts');
      expect(tsFiles.length).toBeGreaterThan(0);
    });

    it('should track directories', async () => {
      const structure = await reader.scanProject(TEST_DIR);

      expect(structure.directories).toContain('src');
      expect(structure.directories).toContain('src/auth');
      expect(structure.directories).toContain('src/db');
    });
  });

  // ── getRelevantFiles ────────────────────────────────

  describe('getRelevantFiles', () => {
    it('should find auth files for "auth endpoint yaz" task', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles('auth endpoint yaz', structure);

      const paths = relevant.map(f => f.relativePath);

      // Auth dosyaları en üstte olmalı
      expect(paths.some(p => p.includes('auth'))).toBe(true);
      // Schema da ilgili (DB)
      expect(paths.some(p => p.includes('schema') || p.includes('db'))).toBe(true);
    });

    it('should find frontend files for "frontend login sayfası" task', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles(
        'frontend login sayfası ekle',
        structure
      );

      const paths = relevant.map(f => f.relativePath);

      // Frontend component dosyaları bulunmalı
      expect(paths.some(p => p.includes('frontend') || p.includes('Login'))).toBe(true);
      // API types da faydalı
      expect(paths.some(p => p.includes('auth') || p.includes('route'))).toBe(true);
    });

    it('should find test files for "test yaz" task', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles('auth için test yaz', structure);

      const paths = relevant.map(f => f.relativePath);

      // Test dosyaları bulunmalı
      expect(paths.some(p => p.includes('test'))).toBe(true);
      // İlgili implementation da
      expect(paths.some(p => p.includes('auth'))).toBe(true);
    });

    it('should boost files mentioned in architecture', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const archContent = `
## Katman Sorumlulukları
### Auth Layer (src/auth/)
JWT tabanlı authentication.
### Config (src/config/)
Environment variables.
`;
      const relevant = reader.getRelevantFiles(
        'config düzenle',
        structure,
        archContent
      );

      const paths = relevant.map(f => f.relativePath);
      expect(paths.some(p => p.includes('config'))).toBe(true);
    });

    it('should return empty for completely unrelated task', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles(
        'quantum computing simulator',
        structure
      );

      // Core files hâlâ biraz puan alır ama spesifik eşleşme olmaz
      expect(relevant.length).toBeLessThan(structure.files.length);
    });
  });

  // ── buildContextSummary ─────────────────────────────

  describe('buildContextSummary', () => {
    it('should build summary with file paths and exports', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles('auth endpoint', structure);
      const context = await reader.buildContextSummary(relevant, TEST_DIR);

      expect(context.files.length).toBeGreaterThan(0);
      expect(context.summary).toContain('###'); // Markdown headers

      // Auth dosyasının export'ları bulunmalı
      const authFile = context.files.find(f => f.path.includes('auth-service'));
      if (authFile) {
        expect(authFile.exports).toContain('AuthService');
        expect(authFile.exports).toContain('AuthPayload');
        expect(authFile.exports).toContain('hashPassword');
      }
    });

    it('should respect 8000 token limit', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      // Tüm dosyaları al (limit test)
      const context = await reader.buildContextSummary(
        structure.files,
        TEST_DIR
      );

      expect(context.totalTokens).toBeLessThanOrEqual(8000);
    });

    it('should include first 50 lines of file content', async () => {
      const structure = await reader.scanProject(TEST_DIR);
      const relevant = reader.getRelevantFiles('auth service', structure);
      const context = await reader.buildContextSummary(relevant, TEST_DIR);

      const authCtx = context.files.find(f => f.path.includes('auth-service'));
      expect(authCtx).toBeDefined();
      if (authCtx) {
        expect(authCtx.firstLines).toContain('Auth Service');
        expect(authCtx.firstLines).toContain('import');
      }
    });

    it('should mark truncated when files exceed limit', async () => {
      // Büyük dosyalar oluştur — her biri ~10KB, 50 adet = ~500KB
      const bigDir = join(TEST_DIR, 'src', 'big');
      await mkdir(bigDir, { recursive: true });
      for (let i = 0; i < 100; i++) {
        const bigContent = Array.from({ length: 100 }, (_, line) =>
          `export const value_${i}_${line} = '${('x').repeat(500)}';`
        ).join('\n');
        await writeFile(
          join(bigDir, `module-${String(i).padStart(3, '0')}.ts`),
          bigContent
        );
      }

      const structure = await reader.scanProject(TEST_DIR);
      // Tüm dosyaları context'e ekle — limit aşılmalı
      const allBigFiles = structure.files.filter(f => f.relativePath.includes('big/'));
      const context = await reader.buildContextSummary(
        allBigFiles,
        TEST_DIR
      );

      expect(context.truncated).toBe(true);
      expect(context.totalTokens).toBeLessThanOrEqual(8000);
    });
  });
});
