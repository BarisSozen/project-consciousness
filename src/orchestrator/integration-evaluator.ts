/**
 * Integration Evaluator — Kod Yazıldıktan Sonra Gerçekten Çalışıyor mu Testi
 *
 * HTTP endpoint'leri test eder:
 * 1. Server başlat (npm run dev / node dist/index.js)
 * 2. Hazır olana kadar bekle
 * 3. HTTP istekleri at, response kontrol et
 * 4. Server'ı durdur
 *
 * D013: Evaluator v2 — gerçek kontroller
 * Yeni: Integration test katmanı
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import type {
  EndpointTest,
  EndpointTestResult,
  IntegrationTestResult,
} from '../types/index.js';

/** Server başlatma timeout (ms) */
const SERVER_START_TIMEOUT = 30_000;
/** Her request timeout (ms) */
const REQUEST_TIMEOUT = 10_000;
/** Default port */
const DEFAULT_PORT = 3000;

/** Task açıklamasından test senaryosu çıkartma pattern'leri */
const TASK_TEST_PATTERNS: Array<{
  keywords: string[];
  tests: EndpointTest[];
}> = [
  {
    keywords: ['auth', 'authentication', 'login', 'register'],
    tests: [
      {
        method: 'POST',
        path: '/auth/register',
        body: { email: 'test@test.com', password: 'Test123!', name: 'Test User' },
        expectedStatus: 201,
        description: 'Register new user',
      },
      {
        method: 'POST',
        path: '/auth/login',
        body: { email: 'test@test.com', password: 'Test123!' },
        expectedStatus: 200,
        description: 'Login existing user',
      },
    ],
  },
  {
    keywords: ['todo', 'todos', 'task list', 'task management'],
    tests: [
      {
        method: 'GET',
        path: '/todos',
        expectedStatus: 200,
        description: 'List all todos',
      },
      {
        method: 'POST',
        path: '/todos',
        body: { title: 'Integration test todo', completed: false },
        expectedStatus: 201,
        description: 'Create new todo',
      },
      {
        method: 'GET',
        path: '/todos',
        expectedStatus: 200,
        description: 'Verify todo was created',
      },
      {
        method: 'DELETE',
        path: '/todos/1',
        expectedStatus: 200,
        description: 'Delete a todo',
      },
    ],
  },
  {
    keywords: ['api', 'rest', 'endpoint', 'server', 'express'],
    tests: [
      {
        method: 'GET',
        path: '/',
        expectedStatus: 200,
        description: 'Root endpoint responds',
      },
      {
        method: 'GET',
        path: '/health',
        expectedStatus: 200,
        description: 'Health check endpoint',
      },
    ],
  },
];

export class IntegrationEvaluator {
  private serverProcess: ChildProcess | null = null;
  private port: number;
  private log: (message: string) => void;

  constructor(
    port = DEFAULT_PORT,
    log?: (message: string) => void
  ) {
    this.port = port;
    this.log = log ?? console.log;
  }

  /**
   * Server'ı başlat. package.json'dan script çöz.
   * Öncelik: npm start > node dist/index.js > npm run dev
   */
  async startServer(projectRoot: string): Promise<boolean> {
    const startCommand = await this.resolveStartCommand(projectRoot);
    if (!startCommand) {
      this.log('  ⚠️ Server başlatma komutu bulunamadı');
      return false;
    }

    this.log(`  🚀 Server başlatılıyor: ${startCommand.cmd} ${startCommand.args.join(' ')}`);

    return new Promise<boolean>((resolve) => {
      const proc = spawn(startCommand.cmd, startCommand.args, {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(this.port), NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      this.serverProcess = proc;

      let resolved = false;
      let output = '';

      const onData = (data: Buffer): void => {
        output += data.toString();
        // Server hazır sinyali
        if (
          output.includes('listening') ||
          output.includes('started') ||
          output.includes(`port ${this.port}`) ||
          output.includes(`:${this.port}`)
        ) {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('error', () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      proc.on('exit', () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      // Timeout fallback — log sinyali gelmese de port kontrolü yap
      setTimeout(() => {
        if (!resolved) {
          this.checkPort(this.port).then(available => {
            if (!resolved) {
              resolved = true;
              resolve(available);
            }
          }).catch(() => {
            if (!resolved) {
              resolved = true;
              resolve(false);
            }
          });
        }
      }, SERVER_START_TIMEOUT);
    });
  }

  /**
   * Server hazır olana kadar bekle (port polling).
   */
  async waitForReady(
    port?: number,
    timeout = SERVER_START_TIMEOUT
  ): Promise<boolean> {
    const targetPort = port ?? this.port;
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeout) {
      const ready = await this.checkPort(targetPort);
      if (ready) return true;
      await this.delay(interval);
    }

    return false;
  }

  /**
   * Tek bir endpoint'i test et.
   */
  async testEndpoint(test: EndpointTest): Promise<EndpointTestResult> {
    const start = Date.now();

    try {
      const response = await this.httpRequest(
        test.method,
        test.path,
        test.body,
        test.headers
      );

      const statusOk = test.expectedStatus
        ? response.status === test.expectedStatus
        : response.status >= 200 && response.status < 400;

      let bodyOk = true;
      if (test.expectedBody && response.body) {
        bodyOk = this.deepIncludes(response.body, test.expectedBody);
      }

      return {
        test,
        passed: statusOk && bodyOk,
        actualStatus: response.status,
        actualBody: response.body,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        test,
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Server'ı durdur.
   */
  stopServer(): void {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      // Grace period sonrası zorla kapat
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.serverProcess.kill('SIGKILL');
        }
      }, 3000);
      this.serverProcess = null;
    }
  }

  /**
   * Task açıklamasından otomatik test senaryoları çıkar.
   */
  inferTestsFromTask(taskDescription: string): EndpointTest[] {
    const descLower = taskDescription.toLowerCase();
    const allTests: EndpointTest[] = [];

    for (const pattern of TASK_TEST_PATTERNS) {
      const match = pattern.keywords.some(kw => descLower.includes(kw));
      if (match) {
        allTests.push(...pattern.tests);
      }
    }

    // Eşleşme yoksa genel API testleri dön
    if (allTests.length === 0) {
      return [
        {
          method: 'GET',
          path: '/',
          description: 'Root endpoint check',
        },
      ];
    }

    return allTests;
  }

  /**
   * Tam integration test akışı:
   * 1. Server başlat
   * 2. Hazır olana kadar bekle
   * 3. Testleri çalıştır
   * 4. Server'ı durdur
   * 5. Sonuçları döndür
   */
  async runFullTest(
    projectRoot: string,
    tests: EndpointTest[]
  ): Promise<IntegrationTestResult> {
    const serverStart = Date.now();

    // 1. Server başlat
    const started = await this.startServer(projectRoot);
    const serverStartTime = Date.now() - serverStart;

    if (!started) {
      this.stopServer();
      return {
        serverStarted: false,
        serverStartTime,
        endpointResults: [],
        passed: 0,
        failed: tests.length,
        total: tests.length,
        summary: `Server başlatılamadı (${serverStartTime}ms). Integration testleri atlandı.`,
      };
    }

    this.log(`  ✅ Server hazır (${serverStartTime}ms)`);

    // 2. Testleri çalıştır
    const results: EndpointTestResult[] = [];
    for (const test of tests) {
      this.log(`  🧪 ${test.method} ${test.path} — ${test.description}`);
      const result = await this.testEndpoint(test);
      results.push(result);
      this.log(`    ${result.passed ? '✅' : '❌'} ${result.actualStatus ?? 'ERR'} (${result.duration}ms)`);
    }

    // 3. Server'ı durdur
    this.stopServer();

    // 4. Sonuçları hesapla
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return {
      serverStarted: true,
      serverStartTime,
      endpointResults: results,
      passed,
      failed,
      total: results.length,
      summary: `Integration: ${passed}/${results.length} passed (server: ${serverStartTime}ms)`,
    };
  }

  // ── Private Helpers ─────────────────────────────────────

  /** package.json'dan start komutu çöz */
  private async resolveStartCommand(
    projectRoot: string
  ): Promise<{ cmd: string; args: string[] } | null> {
    try {
      const pkgContent = await readFile(
        join(projectRoot, 'package.json'),
        'utf-8'
      );
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      const scripts = pkg['scripts'] as Record<string, string> | undefined;

      if (scripts?.['start']) {
        return { cmd: 'npm', args: ['run', 'start'] };
      }
      if (scripts?.['dev']) {
        return { cmd: 'npm', args: ['run', 'dev'] };
      }

      // Fallback: main field
      const main = pkg['main'] as string | undefined;
      if (main) {
        return { cmd: 'node', args: [main] };
      }
    } catch {
      // package.json yok veya parse hatası
    }

    // Python?
    try {
      await readFile(join(projectRoot, 'main.py'), 'utf-8');
      return { cmd: 'python', args: ['main.py'] };
    } catch { /* nope */ }

    return null;
  }

  /** Port açık mı kontrol et */
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2000 },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  /** HTTP request helper */
  private httpRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : undefined;

      const reqHeaders: Record<string, string> = {
        ...(headers ?? {}),
      };
      if (bodyStr) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          path,
          method,
          headers: reqHeaders,
          timeout: REQUEST_TIMEOUT,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            let parsed: unknown = data;
            try {
              parsed = JSON.parse(data);
            } catch {
              // text response
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout: ${method} ${path}`));
      });

      if (bodyStr) {
        req.end(bodyStr);
      } else {
        req.end();
      }
    });
  }

  /** Beklenen body'nin gerçek body'de olup olmadığını kontrol et (shallow) */
  private deepIncludes(
    actual: unknown,
    expected: Record<string, unknown>
  ): boolean {
    if (typeof actual !== 'object' || actual === null) return false;
    const actualObj = actual as Record<string, unknown>;

    for (const [key, value] of Object.entries(expected)) {
      if (actualObj[key] !== value) return false;
    }
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
