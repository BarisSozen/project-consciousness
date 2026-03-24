/**
 * Tracer Agent Tests
 * 
 * Static analyzer, semantic analyzer, runtime tracer ve
 * birleştirilmiş TracerAgent testleri.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StaticAnalyzer } from '../src/agent/tracer/static-analyzer.js';
import { SemanticAnalyzer } from '../src/agent/tracer/semantic-analyzer.js';
import { TracerAgent } from '../src/agent/tracer/tracer-agent.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'pc-tracer-test-' + Date.now());

// ── Test Fixtures ────────────────────────────────────────────

async function setupTestProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src', 'routes'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'services'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'utils'), { recursive: true });

  // package.json
  await writeFile(join(TEST_DIR, 'package.json'), JSON.stringify({
    name: 'test-project',
    dependencies: { express: '^5.0.0', zod: '^3.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
    scripts: { dev: 'node src/index.js', start: 'node src/index.js' },
  }, null, 2));

  // src/index.ts — entry point
  await writeFile(join(TEST_DIR, 'src', 'index.ts'), `
import express from 'express';
import { todoRouter } from './routes/todo.js';
import { authRouter } from './routes/auth.js';

const app = express();
app.use(express.json());
app.use('/todos', todoRouter);
app.use('/auth', authRouter);

app.listen(3000, () => console.log('Server listening on 3000'));
export { app };
`);

  // src/routes/todo.ts — route dosyası
  await writeFile(join(TEST_DIR, 'src', 'routes', 'todo.ts'), `
import { Router } from 'express';
import { TodoService } from '../services/todo-service.js';

export const todoRouter = Router();
const service = new TodoService();

todoRouter.get('/', (req, res) => {
  const todos = service.getAll();
  res.json(todos);
});

todoRouter.post('/', (req, res) => {
  const todo = service.create(req.body);
  res.status(201).json(todo);
});
`);

  // src/routes/auth.ts — route dosyası (service import eksik — wiring problemi!)
  await writeFile(join(TEST_DIR, 'src', 'routes', 'auth.ts'), `
import { Router } from 'express';
// NOT: AuthService import eksik — bu bir wiring sorunu!

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  // AuthService burada olmalıydı ama yok
  res.json({ token: 'fake' });
});
`);

  // src/services/todo-service.ts — service
  await writeFile(join(TEST_DIR, 'src', 'services', 'todo-service.ts'), `
export class TodoService {
  private todos: Array<{ id: number; title: string }> = [];

  getAll() {
    return this.todos;
  }

  create(data: { title: string }) {
    const todo = { id: this.todos.length + 1, title: data.title };
    this.todos.push(todo);
    return todo;
  }

  delete(id: number) {
    this.todos = this.todos.filter(t => t.id !== id);
  }
}

// Dead export — hiçbir yerde kullanılmıyor
export function unusedHelper() {
  return 'dead code';
}
`);

  // src/services/auth-service.ts — service (hiçbir yerde import edilmiyor!)
  await writeFile(join(TEST_DIR, 'src', 'services', 'auth-service.ts'), `
export class AuthService {
  validateCredentials(email: string, password: string): boolean {
    return email.length > 0 && password.length >= 6;
  }

  generateToken(userId: string): string {
    return 'jwt-' + userId;
  }
}
`);

  // src/utils/logger.ts — utility (import var, package.json'da yok)
  await writeFile(join(TEST_DIR, 'src', 'utils', 'logger.ts'), `
import winston from 'winston';  // phantom dep — package.json'da yok!

export const logger = winston.createLogger({
  level: 'info',
});
`);

  // src/utils/config.ts — circular dependency testi
  await writeFile(join(TEST_DIR, 'src', 'utils', 'config.ts'), `
import { logger } from './logger.js';

export const config = {
  port: 3000,
  dbUrl: process.env['DB_URL'] ?? 'sqlite://local.db',
};

logger.info('Config loaded');
`);

  // logger.ts'e config importu ekle → circular dep
  await writeFile(join(TEST_DIR, 'src', 'utils', 'logger.ts'), `
import winston from 'winston';
import { config } from './config.js';  // circular: logger → config → logger

export const logger = winston.createLogger({
  level: config.port ? 'info' : 'debug',
});
`);
}

// ── Static Analyzer Tests ────────────────────────────────────

describe('StaticAnalyzer', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await setupTestProject();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should build import/export graph', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const { imports, exports, edges, files } = await analyzer.buildGraph();

    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(imports.length).toBeGreaterThan(0);
    expect(exports.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('should detect dead exports', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const issues = await analyzer.findIssues();

    const deadExports = issues.filter(i => i.type === 'dead-export');
    // unusedHelper ve AuthService hiçbir yerde kullanılmıyor
    expect(deadExports.length).toBeGreaterThanOrEqual(1);

    const authServiceDead = deadExports.some(i =>
      i.detail.includes('AuthService') || i.detail.includes('unusedHelper')
    );
    expect(authServiceDead).toBe(true);
  });

  it('should detect circular dependencies', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const issues = await analyzer.findIssues();

    const circular = issues.filter(i => i.type === 'circular-dep');
    // logger ↔ config
    expect(circular.length).toBeGreaterThanOrEqual(1);
    expect(circular.some(i => i.detail.includes('logger') || i.detail.includes('config'))).toBe(true);
  });

  it('should detect phantom dependencies', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const issues = await analyzer.findIssues();

    const phantom = issues.filter(i => i.type === 'phantom-dep');
    // winston — package.json'da yok
    expect(phantom.some(i => i.detail.includes('winston'))).toBe(true);
  });

  it('should not false-positive phantom deps in monorepo workspaces', async () => {
    // Monorepo yapısı kur: root + 2 workspace
    const monoDir = TEST_DIR + '-monorepo';
    await mkdir(join(monoDir, 'packages', 'web', 'src'), { recursive: true });
    await mkdir(join(monoDir, 'packages', 'api', 'src'), { recursive: true });

    // Root package.json — sadece typescript
    await writeFile(join(monoDir, 'package.json'), JSON.stringify({
      name: 'monorepo-root',
      private: true,
      devDependencies: { typescript: '^5.0.0' },
    }));

    // pnpm-workspace.yaml
    await writeFile(join(monoDir, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n');

    // web workspace — react tanımlı
    await writeFile(join(monoDir, 'packages', 'web', 'package.json'), JSON.stringify({
      name: '@mono/web',
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
    }));
    await writeFile(join(monoDir, 'packages', 'web', 'src', 'app.tsx'),
      `import React from 'react';\nimport ReactDOM from 'react-dom';\nexport const App = () => <div>Hi</div>;\n`);

    // api workspace — express tanımlı, axios PHANTOM
    await writeFile(join(monoDir, 'packages', 'api', 'package.json'), JSON.stringify({
      name: '@mono/api',
      dependencies: { express: '^5.0.0' },
    }));
    await writeFile(join(monoDir, 'packages', 'api', 'src', 'server.ts'),
      `import express from 'express';\nimport axios from 'axios';\nconst app = express();\nexport { app };\n`);

    const analyzer = new StaticAnalyzer(monoDir);
    const issues = await analyzer.findIssues();
    const phantom = issues.filter(i => i.type === 'phantom-dep');

    // react, react-dom, express → workspace'lerde tanımlı, phantom olmamalı
    expect(phantom.some(i => i.detail.includes("'react'"))).toBe(false);
    expect(phantom.some(i => i.detail.includes("'express'"))).toBe(false);

    // axios → hiçbir package.json'da yok, phantom olmalı
    expect(phantom.some(i => i.detail.includes("'axios'"))).toBe(true);

    await rm(monoDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should extract named and default exports correctly', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const { exports } = await analyzer.buildGraph();

    const todoServiceExports = exports.filter(e => e.file.includes('todo-service'));
    expect(todoServiceExports.some(e => e.symbol === 'TodoService')).toBe(true);
    expect(todoServiceExports.some(e => e.symbol === 'unusedHelper')).toBe(true);
  });

  it('should resolve TypeScript .js → .ts imports', async () => {
    const analyzer = new StaticAnalyzer(TEST_DIR);
    const { edges } = await analyzer.buildGraph();

    // todo route → todo-service bağlantısı olmalı
    const todoEdge = edges.find(e =>
      e.source.includes('todo') && e.target.includes('todo-service')
    );
    expect(todoEdge).toBeDefined();
    expect(todoEdge!.symbols).toContain('TodoService');
  });
});

// ── Semantic Analyzer Tests ──────────────────────────────────

describe('SemanticAnalyzer', () => {
  it('should return empty array when no API key', async () => {
    const analyzer = new SemanticAnalyzer(); // no API key
    const insights = await analyzer.analyze([], [], new Map());
    expect(insights).toEqual([]);
  });

  it('should convert insights to wiring issues', () => {
    const analyzer = new SemanticAnalyzer();
    const issues = analyzer.toWiringIssues([
      {
        category: 'injection-missing',
        description: 'AuthService auth route\'a inject edilmemiş',
        files: ['src/routes/auth.ts', 'src/services/auth-service.ts'],
        confidence: 0.9,
      },
      {
        category: 'config-mismatch',
        description: 'DB_URL tanımsız',
        files: ['src/utils/config.ts'],
        confidence: 0.3, // düşük güven — filtrelenmeli
      },
    ]);

    // confidence >= 0.5 olanlar geçer
    expect(issues.length).toBe(1);
    expect(issues[0]!.detail).toContain('AuthService');
  });
});

// ── TracerAgent Integration Tests ────────────────────────────

describe('TracerAgent', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await setupTestProject();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should run static-only analysis', async () => {
    const tracer = new TracerAgent({
      projectRoot: TEST_DIR,
      layers: { static: true, semantic: false, runtime: false },
      log: () => {}, // sessiz
    });

    const report = await tracer.run();

    expect(report.graph.nodes.length).toBeGreaterThan(0);
    expect(report.graph.edges.length).toBeGreaterThan(0);
    expect(report.staticIssues.length).toBeGreaterThan(0);
    expect(report.semanticInsights).toEqual([]);
    expect(report.runtimeTraces).toEqual([]);
    expect(report.summary.totalFiles).toBeGreaterThan(0);
    expect(report.summary.totalIssues).toBeGreaterThan(0);
    expect(report.timestamp).toBeTruthy();
  });

  it('should find all issue types in test project', async () => {
    const tracer = new TracerAgent({
      projectRoot: TEST_DIR,
      layers: { static: true, semantic: false, runtime: false },
      log: () => {},
    });

    const report = await tracer.run();
    const issueTypes = new Set(report.allIssues.map(i => i.type));

    // Test projemizde en az şunlar olmalı:
    expect(issueTypes.has('dead-export')).toBe(true);    // unusedHelper, AuthService
    expect(issueTypes.has('circular-dep')).toBe(true);    // logger ↔ config
    expect(issueTypes.has('phantom-dep')).toBe(true);     // winston
  });

  it('should produce sorted issues (critical first)', async () => {
    const tracer = new TracerAgent({
      projectRoot: TEST_DIR,
      layers: { static: true, semantic: false, runtime: false },
      log: () => {},
    });

    const report = await tracer.run();

    // allIssues critical → warning → info sıralı olmalı
    const severities = report.allIssues.map(i => i.severity);
    const criticalIdx = severities.indexOf('critical');
    const infoIdx = severities.lastIndexOf('info');

    if (criticalIdx >= 0 && infoIdx >= 0) {
      expect(criticalIdx).toBeLessThan(infoIdx);
    }
  });

  it('should include suggestion for every issue', async () => {
    const tracer = new TracerAgent({
      projectRoot: TEST_DIR,
      layers: { static: true, semantic: false, runtime: false },
      log: () => {},
    });

    const report = await tracer.run();

    // Her sorunun suggestion alanı olmalı (en azından static issues)
    for (const issue of report.staticIssues) {
      expect(issue.suggestion).toBeTruthy();
    }
  });
});
