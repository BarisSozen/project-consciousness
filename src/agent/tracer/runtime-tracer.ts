/**
 * Runtime Tracer — Çalışma Zamanı Data Flow İzleme
 *
 * 1. Server başlat (npm run dev / node dist/index.js)
 * 2. Test HTTP request'leri at
 * 3. Request → response arasındaki handler zincirini izle
 * 4. Data flow adımlarını kaydet
 * 5. Gap'leri tespit et (middleware atlanmış, handler bağlanmamış, vs.)
 *
 * İzleme yöntemi:
 * - Instrumented server: dinamik olarak require hook / loader inject
 * - VEYA çıktı analizi: server loglarından flow çıkar
 * - VEYA HTTP probe: request/response pattern'lerinden infer
 *
 * Bu implementasyon HTTP probe + log analizi kullanır (en az invasive).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import type {
  RuntimeCall,
  RuntimeHttpEvent,
  RequestTrace,
  DataFlowStep,
  WiringIssue,
} from '../../types/index.js';

/** Server başlatma timeout (ms) */
const SERVER_START_TIMEOUT = 15_000;
/** Her request timeout (ms) */
const REQUEST_TIMEOUT = 10_000;
/** Trace edilecek default endpoint'ler */
const PROBE_ENDPOINTS = [
  { method: 'GET', path: '/', description: 'Root / health check' },
  { method: 'GET', path: '/api', description: 'API root' },
  { method: 'GET', path: '/health', description: 'Health endpoint' },
  { method: 'GET', path: '/todos', description: 'List resource' },
  { method: 'GET', path: '/users', description: 'Users endpoint' },
  { method: 'POST', path: '/auth/register', body: { email: 'trace@test.com', password: 'Test123!', name: 'Tracer' }, description: 'Auth register' },
  { method: 'POST', path: '/auth/login', body: { email: 'trace@test.com', password: 'Test123!' }, description: 'Auth login' },
];

interface ProbeEndpoint {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  description: string;
}

export class RuntimeTracer {
  private projectRoot: string;
  private port: number;
  private serverProcess: ChildProcess | null = null;
  private serverLogs: string[] = [];

  constructor(projectRoot: string, port = 3000) {
    this.projectRoot = projectRoot;
    this.port = port;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Server başlat, probe'la, trace topla, server'ı kapat
   */
  async trace(customEndpoints?: ProbeEndpoint[]): Promise<{
    traces: RequestTrace[];
    issues: WiringIssue[];
    serverLog: string;
  }> {
    const endpoints = customEndpoints ?? await this.discoverEndpoints();
    const traces: RequestTrace[] = [];
    const issues: WiringIssue[] = [];

    // 1. Instrumentation inject et (opsiyonel — Express middleware)
    const instrumented = await this.injectInstrumentation();

    // 2. Server başlat
    const started = await this.startServer();
    if (!started) {
      issues.push({
        type: 'runtime-gap',
        severity: 'critical',
        file: 'package.json',
        detail: 'Server başlatılamadı — runtime trace yapılamıyor',
        suggestion: 'npm run dev veya npm start komutunun çalıştığını doğrula',
      });
      return { traces, issues, serverLog: this.serverLogs.join('\n') };
    }

    // 3. Her endpoint'i probe et
    for (const endpoint of endpoints) {
      try {
        const trace = await this.probeEndpoint(endpoint);
        traces.push(trace);

        // Gap analizi — bu trace'de sorun var mı?
        const gapIssues = this.analyzeTrace(trace);
        trace.gaps = gapIssues;
        issues.push(...gapIssues);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        issues.push({
          type: 'runtime-gap',
          severity: 'warning',
          file: endpoint.path,
          detail: `Endpoint probe başarısız: ${endpoint.method} ${endpoint.path} — ${msg}`,
          suggestion: `Route tanımlı mı? Handler bağlı mı?`,
        });
      }
    }

    // 4. Server loglarından ek flow bilgisi çıkar
    const logInsights = this.analyzeServerLogs();
    issues.push(...logInsights);

    // 5. Server'ı kapat ve temizle
    await this.stopServer();
    if (instrumented) {
      await this.removeInstrumentation();
    }

    return { traces, issues, serverLog: this.serverLogs.join('\n') };
  }

  // ── Server Management ──────────────────────────────────────

  private async startServer(): Promise<boolean> {
    // Hangi komutla başlatılacağını belirle
    const startCommand = await this.detectStartCommand();
    if (!startCommand) return false;

    return new Promise((resolve) => {
      const [cmd, ...args] = startCommand.split(' ');

      this.serverProcess = spawn(cmd!, args, {
        cwd: this.projectRoot,
        env: { ...process.env, PORT: String(this.port), NODE_ENV: 'development' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      const timer = setTimeout(() => {
        // Timeout — ama belki server yine de ayakta, port kontrol et
        this.checkPort().then(resolve);
      }, SERVER_START_TIMEOUT);

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        this.serverLogs.push(line);
        // "listening on port" gibi pattern'ler
        if (/listen|ready|started|running/i.test(line)) {
          clearTimeout(timer);
          // Kısa bekle, port açılsın
          setTimeout(() => resolve(true), 500);
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        this.serverLogs.push(`[stderr] ${data.toString()}`);
      });

      this.serverProcess.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });

      this.serverProcess.on('close', (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
  }

  private async stopServer(): Promise<void> {
    if (!this.serverProcess) return;
    this.serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.serverProcess?.kill('SIGKILL');
        resolve();
      }, 5000);
      this.serverProcess!.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.serverProcess = null;
  }

  // ── Endpoint Probing ───────────────────────────────────────

  private async probeEndpoint(endpoint: ProbeEndpoint): Promise<RequestTrace> {
    const startTime = Date.now();
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Özel trace header ekle — instrumented server bunu loglar
    const headers: Record<string, string> = {
      'X-Trace-Id': traceId,
      'Content-Type': 'application/json',
      ...(endpoint.headers ?? {}),
    };

    const httpEvent = await this.makeRequest(
      endpoint.method,
      endpoint.path,
      endpoint.body,
      headers
    );

    // Server loglarından bu request'in handler zincirini çıkar
    const calls = this.extractCallsFromLogs(traceId, startTime);
    const dataFlow = this.inferDataFlow(endpoint, httpEvent, calls);

    return {
      id: traceId,
      httpEvent,
      calls,
      dataFlow,
      gaps: [], // analyze sonra doldurulacak
    };
  }

  private makeRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<RuntimeHttpEvent> {
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port: this.port,
        path,
        method,
        headers: {
          ...headers,
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: REQUEST_TIMEOUT,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            timestamp: start,
            method,
            path,
            status: res.statusCode ?? 0,
            requestBody: bodyStr?.slice(0, 500),
            responseBody: data.slice(0, 1000),
            duration: Date.now() - start,
            handlerChain: this.extractHandlerChain(path),
          });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout: ${method} ${path}`));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ── Flow Analysis ──────────────────────────────────────────

  private inferDataFlow(
    endpoint: ProbeEndpoint,
    httpEvent: RuntimeHttpEvent,
    calls: RuntimeCall[]
  ): DataFlowStep[] {
    const steps: DataFlowStep[] = [];
    let order = 0;

    // Adım 1: HTTP giriş (controller/route)
    steps.push({
      order: order++,
      layer: 'controller',
      file: this.guessFileForPath(endpoint.path),
      function: `${endpoint.method} ${endpoint.path}`,
      dataIn: endpoint.body ? `JSON(${Object.keys(endpoint.body).join(', ')})` : 'none',
      dataOut: `status ${httpEvent.status}`,
    });

    // Adım 2: Middleware (auth, validation, vs.)
    if (httpEvent.status === 401 || httpEvent.status === 403) {
      steps.push({
        order: order++,
        layer: 'middleware',
        file: 'middleware/auth',
        function: 'authMiddleware',
        dataIn: 'request headers',
        dataOut: `${httpEvent.status} — auth rejected`,
        transform: 'JWT/session verification',
      });
    }

    // Adım 3: Runtime call'lardan flow çıkar
    for (const call of calls) {
      steps.push({
        order: order++,
        layer: this.inferLayer(call.file, call.function),
        file: call.file,
        function: call.function,
        dataIn: call.args?.slice(0, 100),
        dataOut: call.returnType,
        transform: undefined,
      });
    }

    // Son adım: HTTP response
    steps.push({
      order: order++,
      layer: 'controller',
      file: this.guessFileForPath(endpoint.path),
      function: 'response',
      dataIn: 'service result',
      dataOut: `HTTP ${httpEvent.status}, body: ${(httpEvent.responseBody ?? '').slice(0, 100)}`,
    });

    return steps;
  }

  private analyzeTrace(trace: RequestTrace): WiringIssue[] {
    const issues: WiringIssue[] = [];

    // 404 → route tanımlı değil
    if (trace.httpEvent.status === 404) {
      issues.push({
        type: 'runtime-gap',
        severity: 'warning',
        file: trace.httpEvent.path,
        detail: `Route bulunamadı: ${trace.httpEvent.method} ${trace.httpEvent.path} → 404`,
        suggestion: 'Route tanımını kontrol et, router middleware\'ini app\'e bağladığından emin ol',
      });
    }

    // 500 → handler patlamış
    if (trace.httpEvent.status >= 500) {
      issues.push({
        type: 'runtime-gap',
        severity: 'critical',
        file: trace.httpEvent.path,
        detail: `Server error: ${trace.httpEvent.method} ${trace.httpEvent.path} → ${trace.httpEvent.status}`,
        suggestion: 'Error handler ve handler fonksiyonunu kontrol et, server loglarını incele',
      });
    }

    // Çok yavaş response (>5s) → muhtemelen beklenen service bağlanmamış
    if (trace.httpEvent.duration > 5000) {
      issues.push({
        type: 'runtime-gap',
        severity: 'warning',
        file: trace.httpEvent.path,
        detail: `Yavaş response: ${trace.httpEvent.method} ${trace.httpEvent.path} → ${trace.httpEvent.duration}ms`,
        suggestion: 'DB bağlantısı, external service veya unresolved promise olabilir',
      });
    }

    // Boş response body (beklenmedik)
    if (trace.httpEvent.status === 200 && !trace.httpEvent.responseBody?.trim()) {
      issues.push({
        type: 'runtime-gap',
        severity: 'info',
        file: trace.httpEvent.path,
        detail: `Boş response body: ${trace.httpEvent.method} ${trace.httpEvent.path}`,
        suggestion: 'Handler response gönderiyor mu? res.json() veya res.send() çağrılmış mı?',
      });
    }

    // Data flow gap: controller var ama service yok
    const layers = new Set(trace.dataFlow.map(s => s.layer));
    if (layers.has('controller') && !layers.has('service') && trace.httpEvent.status < 400) {
      issues.push({
        type: 'runtime-gap',
        severity: 'info',
        file: trace.httpEvent.path,
        detail: `Controller direkt response dönüyor, service katmanı yok: ${trace.httpEvent.method} ${trace.httpEvent.path}`,
        suggestion: 'Business logic\'i bir service\'e ayırmak ileride test edilebilirliği artırır',
      });
    }

    return issues;
  }

  // ── Server Log Analysis ────────────────────────────────────

  private analyzeServerLogs(): WiringIssue[] {
    const issues: WiringIssue[] = [];
    const logText = this.serverLogs.join('\n').toLowerCase();

    // Tipik hata pattern'leri
    const errorPatterns: Array<{ pattern: RegExp; detail: string; severity: WiringIssue['severity'] }> = [
      { pattern: /cannot find module ['"]([^'"]+)['"]/i, detail: 'Module bulunamadı: $1', severity: 'critical' },
      { pattern: /is not a function/i, detail: 'Fonksiyon bulunamadı — yanlış import veya undefined inject', severity: 'critical' },
      { pattern: /is not defined/i, detail: 'Tanımsız değişken — wiring eksik olabilir', severity: 'critical' },
      { pattern: /eaddrinuse/i, detail: 'Port zaten kullanımda', severity: 'warning' },
      { pattern: /econnrefused/i, detail: 'Bağlantı reddedildi — external service ayakta mı?', severity: 'warning' },
      { pattern: /unhandled.*rejection/i, detail: 'Yakalanmamış async hata — promise chain kırık', severity: 'warning' },
      { pattern: /deprecat/i, detail: 'Deprecated API kullanımı tespit edildi', severity: 'info' },
    ];

    for (const { pattern, detail, severity } of errorPatterns) {
      const match = logText.match(pattern);
      if (match) {
        const resolvedDetail = detail.replace('$1', match[1] ?? '');
        issues.push({
          type: 'runtime-gap',
          severity,
          file: 'server-log',
          detail: `[Runtime] ${resolvedDetail}`,
          suggestion: 'Server loglarını incele ve ilgili modülün doğru bağlandığından emin ol',
        });
      }
    }

    return issues;
  }

  // ── Helpers ────────────────────────────────────────────────

  private async detectStartCommand(): Promise<string | null> {
    try {
      const pkg = JSON.parse(await readFile(join(this.projectRoot, 'package.json'), 'utf-8'));
      const scripts = pkg.scripts ?? {};

      // Öncelik: dev → start → custom
      if (scripts.dev) return `npm run dev`;
      if (scripts.start) return `npm start`;
      if (scripts['serve']) return `npm run serve`;

      // Fallback: main field
      if (pkg.main) return `node ${pkg.main}`;

      return null;
    } catch {
      return null;
    }
  }

  private async discoverEndpoints(): Promise<ProbeEndpoint[]> {
    // Route dosyalarından endpoint keşfi
    const endpoints = [...PROBE_ENDPOINTS];

    try {
      const pkg = JSON.parse(await readFile(join(this.projectRoot, 'package.json'), 'utf-8'));
      const hasExpress = !!(pkg.dependencies?.express || pkg.devDependencies?.express);

      if (hasExpress) {
        // Express projesi — src/routes/ veya src/api/ altında route dosyaları ara
        // TODO: daha akıllı route discovery
      }
    } catch { /* ignore */ }

    return endpoints;
  }

  private async checkPort(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${this.port}/`, () => resolve(true));
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }

  private extractCallsFromLogs(traceId: string, startTime: number): RuntimeCall[] {
    const calls: RuntimeCall[] = [];

    // X-Trace-Id header'ını loglayan instrumented middleware varsa
    for (const log of this.serverLogs) {
      if (log.includes(traceId)) {
        // [trace-xxx] handler: functionName (file.ts) 10ms
        const match = log.match(/\[.*\]\s*(\w+):\s*(\w+)\s*\(([^)]+)\)\s*(\d+)ms/);
        if (match) {
          calls.push({
            timestamp: startTime,
            file: match[3]!,
            function: match[2]!,
            duration: parseInt(match[4]!, 10),
          });
        }
      }
    }

    return calls;
  }

  private extractHandlerChain(path: string): string[] {
    // Server loglarından bu path'e hangi handler'ların yanıt verdiğini çıkar
    const chain: string[] = [];
    for (const log of this.serverLogs) {
      if (log.includes(path) && /handler|middleware|route/i.test(log)) {
        const match = log.match(/(\w+(?:Handler|Middleware|Router))/);
        if (match) chain.push(match[1]!);
      }
    }
    return chain.length > 0 ? chain : ['unknown-handler'];
  }

  private guessFileForPath(urlPath: string): string {
    // /auth/login → src/routes/auth.ts veya src/controllers/auth.ts
    const segment = urlPath.split('/').filter(s => s.length > 0)[0] ?? 'index';
    return `src/routes/${segment}.ts`;
  }

  private inferLayer(file: string, fn: string): DataFlowStep['layer'] {
    const lower = (file + fn).toLowerCase();
    if (lower.includes('controller') || lower.includes('route') || lower.includes('handler')) return 'controller';
    if (lower.includes('middleware') || lower.includes('guard') || lower.includes('auth')) return 'middleware';
    if (lower.includes('service') || lower.includes('usecase')) return 'service';
    if (lower.includes('repo') || lower.includes('dal') || lower.includes('db')) return 'repository';
    if (lower.includes('model') || lower.includes('entity') || lower.includes('schema')) return 'model';
    if (lower.includes('util') || lower.includes('helper') || lower.includes('lib')) return 'util';
    return 'service';
  }

  // ── Instrumentation (Express middleware injection) ──────────

  /**
   * Geçici bir trace middleware dosyası oluştur.
   * Server başlatıldığında bu middleware her request'i loglar.
   */
  private async injectInstrumentation(): Promise<boolean> {
    const instrumentPath = join(this.projectRoot, '__pc_trace_middleware.js');

    const middleware = `
// Auto-generated by Project Consciousness Tracer — silmek güvenlidir
const TRACE_HEADER = 'x-trace-id';
module.exports = function pcTraceMiddleware(req, res, next) {
  const traceId = req.headers[TRACE_HEADER] || 'no-trace';
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;
    console.log('[' + traceId + '] ' + req.method + ' ' + req.path + ' → ' + res.statusCode + ' (' + duration + 'ms)');
    return originalEnd.apply(this, args);
  };
  next();
};
`;

    try {
      await writeFile(instrumentPath, middleware, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private async removeInstrumentation(): Promise<void> {
    const instrumentPath = join(this.projectRoot, '__pc_trace_middleware.js');
    try {
      const { rm } = await import('node:fs/promises');
      await rm(instrumentPath, { force: true });
    } catch { /* sessizce geç */ }
  }
}
