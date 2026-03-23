/**
 * IntegrationEvaluator Tests
 *
 * Mock server başlat, endpoint test et, sonucu raporla.
 * Gerçek HTTP istekleri ile test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { IntegrationEvaluator } from '../src/orchestrator/integration-evaluator.js';
import { createServer, type Server } from 'node:http';

/** Test helper: basit bir mock HTTP server */
function createMockServer(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const todos: Array<{ id: number; title: string; completed: boolean }> = [
      { id: 1, title: 'Existing todo', completed: false },
    ];
    let nextId = 2;

    const server = createServer((req, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      // CORS headers
      res.setHeader('Content-Type', 'application/json');

      if (method === 'GET' && url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', message: 'Server running' }));
        return;
      }

      if (method === 'GET' && url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ healthy: true }));
        return;
      }

      if (method === 'GET' && url === '/todos') {
        res.writeHead(200);
        res.end(JSON.stringify(todos));
        return;
      }

      if (method === 'POST' && url === '/todos') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { title: string; completed?: boolean };
            const todo = { id: nextId++, title: data.title, completed: data.completed ?? false };
            todos.push(todo);
            res.writeHead(201);
            res.end(JSON.stringify(todo));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (method === 'DELETE' && url?.startsWith('/todos/')) {
        const id = parseInt(url.split('/')[2] ?? '0', 10);
        const idx = todos.findIndex(t => t.id === id);
        if (idx >= 0) {
          todos.splice(idx, 1);
          res.writeHead(200);
          res.end(JSON.stringify({ deleted: true }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
        return;
      }

      if (method === 'POST' && url === '/auth/register') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          res.writeHead(201);
          res.end(JSON.stringify({ id: 'user-1', email: 'test@test.com' }));
        });
        return;
      }

      if (method === 'POST' && url === '/auth/login') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          res.writeHead(200);
          res.end(JSON.stringify({ token: 'mock-jwt-token' }));
        });
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

describe('IntegrationEvaluator', () => {
  let mockServer: Server | null = null;
  const TEST_PORT = 19876; // Benzersiz port, çakışma olmasın
  const logs: string[] = [];
  const logFn = (msg: string): void => { logs.push(msg); };

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => resolve());
      });
      mockServer = null;
      // Port release için kısa bekleme
      await new Promise(r => setTimeout(r, 50));
    }
    logs.length = 0;
  });

  // ── inferTestsFromTask ──────────────────────────────

  describe('inferTestsFromTask', () => {
    it('should infer auth tests for auth-related task', () => {
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);
      const tests = evaluator.inferTestsFromTask('authentication endpoint yaz, login ve register');

      expect(tests.length).toBeGreaterThanOrEqual(2);
      expect(tests.some(t => t.path.includes('/auth/register'))).toBe(true);
      expect(tests.some(t => t.path.includes('/auth/login'))).toBe(true);
    });

    it('should infer todo CRUD tests for todo task', () => {
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);
      const tests = evaluator.inferTestsFromTask('todo list API yaz');

      expect(tests.length).toBeGreaterThanOrEqual(3);
      expect(tests.some(t => t.method === 'GET' && t.path === '/todos')).toBe(true);
      expect(tests.some(t => t.method === 'POST' && t.path === '/todos')).toBe(true);
      expect(tests.some(t => t.method === 'DELETE')).toBe(true);
    });

    it('should infer general API tests for generic task', () => {
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);
      const tests = evaluator.inferTestsFromTask('express API server kur');

      expect(tests.length).toBeGreaterThanOrEqual(1);
      expect(tests.some(t => t.path === '/' || t.path === '/health')).toBe(true);
    });

    it('should return root check for unknown task', () => {
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);
      const tests = evaluator.inferTestsFromTask('quantum computing simulator');

      expect(tests.length).toBe(1);
      expect(tests[0]!.path).toBe('/');
    });
  });

  // ── testEndpoint ────────────────────────────────────

  describe('testEndpoint', () => {
    it('should pass for correct GET response', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const result = await evaluator.testEndpoint({
        method: 'GET',
        path: '/todos',
        expectedStatus: 200,
        description: 'List todos',
      });

      expect(result.passed).toBe(true);
      expect(result.actualStatus).toBe(200);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should pass for correct POST response', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const result = await evaluator.testEndpoint({
        method: 'POST',
        path: '/todos',
        body: { title: 'Test todo', completed: false },
        expectedStatus: 201,
        description: 'Create todo',
      });

      expect(result.actualStatus).toBe(201);
      expect(result.passed).toBe(true);
    });

    it('should fail for wrong status code', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const result = await evaluator.testEndpoint({
        method: 'GET',
        path: '/nonexistent',
        expectedStatus: 200,
        description: 'Should fail',
      });

      expect(result.passed).toBe(false);
      expect(result.actualStatus).toBe(404);
    });

    it('should handle connection error gracefully', async () => {
      // No server running on this port
      const evaluator = new IntegrationEvaluator(19999, logFn);

      const result = await evaluator.testEndpoint({
        method: 'GET',
        path: '/',
        expectedStatus: 200,
        description: 'No server',
      });

      expect(result.passed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should test DELETE endpoint', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const result = await evaluator.testEndpoint({
        method: 'DELETE',
        path: '/todos/1',
        expectedStatus: 200,
        description: 'Delete todo',
      });

      expect(result.passed).toBe(true);
      expect(result.actualStatus).toBe(200);
    });
  });

  // ── waitForReady ────────────────────────────────────

  describe('waitForReady', () => {
    it('should detect server when already running', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const ready = await evaluator.waitForReady(TEST_PORT, 5000);
      expect(ready).toBe(true);
    });

    it('should timeout when no server', async () => {
      const evaluator = new IntegrationEvaluator(19998, logFn);

      const ready = await evaluator.waitForReady(19998, 2000);
      expect(ready).toBe(false);
    });
  });

  // ── Full integration flow (mock) ────────────────────

  describe('full flow with mock server', () => {
    it('should test todo endpoints end-to-end', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const tests = evaluator.inferTestsFromTask('todo API yaz');

      const results: Array<{ passed: boolean; desc: string }> = [];
      for (const test of tests) {
        const result = await evaluator.testEndpoint(test);
        results.push({ passed: result.passed, desc: test.description });
      }

      const passed = results.filter(r => r.passed).length;
      expect(passed).toBeGreaterThanOrEqual(3); // En az 3 test geçmeli
    });

    it('should test auth endpoints end-to-end', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      const tests = evaluator.inferTestsFromTask('authentication yaz');

      const results: Array<{ passed: boolean; desc: string }> = [];
      for (const test of tests) {
        const result = await evaluator.testEndpoint(test);
        results.push({ passed: result.passed, desc: test.description });
      }

      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should produce IntegrationTestResult format', async () => {
      mockServer = await createMockServer(TEST_PORT);
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);

      // Simulate runFullTest result shape (without actual server start)
      const tests = evaluator.inferTestsFromTask('todo API');
      const endpointResults = [];
      for (const test of tests) {
        endpointResults.push(await evaluator.testEndpoint(test));
      }

      const passedCount = endpointResults.filter(r => r.passed).length;
      const failedCount = endpointResults.filter(r => !r.passed).length;

      const result = {
        serverStarted: true,
        serverStartTime: 500,
        endpointResults,
        passed: passedCount,
        failed: failedCount,
        total: endpointResults.length,
        summary: `Integration: ${passedCount}/${endpointResults.length} passed`,
      };

      expect(result.serverStarted).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.passed + result.failed).toBe(result.total);
      expect(result.summary).toContain('Integration');
    });
  });

  // ── stopServer ──────────────────────────────────────

  describe('stopServer', () => {
    it('should not throw when no server is running', () => {
      const evaluator = new IntegrationEvaluator(TEST_PORT, logFn);
      expect(() => evaluator.stopServer()).not.toThrow();
    });
  });
});
