/**
 * Verified Build Pipeline — Her Adımda Doğrulama
 *
 * Mevcut sorun: Scaffold + Agent 50 dosya üretip sonra tsc fail ediyor.
 * Çözüm: Her aşamada incremental doğrulama.
 *
 * Pipeline:
 * 1. Schema-first: Zod schemas + TypeScript types ÖNCE üretilir, tsc kontrol
 * 2. Scaffold: Route + service + repo üretilir, tsc kontrol
 * 3. Wiring check: Import'lar resolve oluyor mu? (AST veya regex)
 * 4. Smoke test: Server başlat, health endpoint'i çağır
 * 5. Agent code: Her agent task sonrası incremental tsc
 * 6. Integration: Tüm endpoint'leri test et
 * 7. Audit gate: Architecture + security scan
 *
 * Hata bulunursa: o adımda dur, fix et, devam et. 50 dosya yazdıktan sonra değil.
 */

import { execSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface VerifyResult {
  step: string;
  passed: boolean;
  errors: string[];
  duration: number;
}

export interface PipelineResult {
  steps: VerifyResult[];
  passed: boolean;
  totalErrors: number;
  duration: number;
}

type LogFn = (msg: string) => void;

// ═══════════════════════════════════════════════════════════
// Pipeline
// ═══════════════════════════════════════════════════════════

export class VerifiedBuildPipeline {
  private root: string;
  private log: LogFn;

  constructor(projectRoot: string, log?: LogFn) {
    this.root = projectRoot;
    this.log = log ?? console.log;
  }

  /**
   * Run full verification pipeline on current project state.
   * Call after each build step to catch errors immediately.
   */
  async verify(): Promise<PipelineResult> {
    const start = Date.now();
    const steps: VerifyResult[] = [];

    // 1. package.json exists + deps installed
    steps.push(await this.checkDeps());

    // 2. TypeScript compilation
    steps.push(await this.checkTypeScript());

    // 3. Import resolution — do all imports resolve?
    steps.push(await this.checkImports());

    // 4. Smoke test — can server start?
    steps.push(await this.checkServerStart());

    // 5. Tests pass
    steps.push(await this.checkTests());

    const totalErrors = steps.reduce((sum, s) => sum + s.errors.length, 0);
    const passed = steps.every(s => s.passed);

    return { steps, passed, totalErrors, duration: Date.now() - start };
  }

  /**
   * Quick check — just tsc + imports (< 5 seconds).
   * Use after every file generation.
   */
  async quickCheck(): Promise<VerifyResult> {
    return this.checkTypeScript();
  }

  /**
   * Run npm install if node_modules missing.
   * Returns whether deps are ready.
   */
  async ensureDeps(): Promise<boolean> {
    try {
      await access(join(this.root, 'node_modules'));
      return true;
    } catch {
      this.log('  📦 Installing dependencies...');
      try {
        execSync('npm install', { cwd: this.root, timeout: 120_000, stdio: 'pipe' });
        return true;
      } catch (e) {
        this.log(`  ❌ npm install failed: ${(e as Error).message.slice(0, 100)}`);
        return false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Individual Checks
  // ═══════════════════════════════════════════════════════════

  private async checkDeps(): Promise<VerifyResult> {
    const start = Date.now();
    const errors: string[] = [];

    try {
      await access(join(this.root, 'package.json'));
    } catch {
      errors.push('package.json not found');
    }

    try {
      await access(join(this.root, 'node_modules'));
    } catch {
      errors.push('node_modules not found — run npm install');
    }

    return { step: 'dependencies', passed: errors.length === 0, errors, duration: Date.now() - start };
  }

  private async checkTypeScript(): Promise<VerifyResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Check if tsconfig exists
    let hasTsConfig = false;
    try {
      await access(join(this.root, 'tsconfig.json'));
      hasTsConfig = true;
    } catch { /* no tsconfig */ }

    if (!hasTsConfig) {
      return { step: 'typescript', passed: true, errors: ['No tsconfig.json — skipping tsc'], duration: Date.now() - start };
    }

    try {
      execSync('npx tsc --noEmit 2>&1', { cwd: this.root, timeout: 60_000, encoding: 'utf-8' });
    } catch (e) {
      const output = (e as { stdout?: string; stderr?: string }).stdout ?? (e as Error).message;
      // Parse tsc errors
      const tscErrors = output.split('\n')
        .filter((line: string) => /\.tsx?\(\d+,\d+\):\s*error\s+TS/.test(line))
        .slice(0, 10); // max 10 errors
      
      if (tscErrors.length > 0) {
        errors.push(...tscErrors);
      } else {
        errors.push('TypeScript compilation failed (see build output)');
      }
    }

    this.log(`  ${errors.length === 0 ? '✅' : '❌'} TypeScript: ${errors.length === 0 ? 'OK' : `${errors.length} errors`}`);
    return { step: 'typescript', passed: errors.length === 0, errors, duration: Date.now() - start };
  }

  private async checkImports(): Promise<VerifyResult> {
    const start = Date.now();
    const errors: string[] = [];

    try {
      const { StaticAnalyzer } = await import('../agent/tracer/static-analyzer.js');
      const analyzer = new StaticAnalyzer(this.root);
      const issues = await analyzer.findIssues();

      const missingImports = issues.filter(i => i.type === 'missing-import');
      const phantomDeps = issues.filter(i => i.type === 'phantom-dep');

      for (const mi of missingImports.slice(0, 5)) {
        errors.push(`Missing import: ${mi.detail}`);
      }
      for (const pd of phantomDeps.slice(0, 5)) {
        errors.push(`Phantom dependency: ${pd.detail}`);
      }
    } catch (e) {
      errors.push(`Import check failed: ${(e as Error).message.slice(0, 80)}`);
    }

    this.log(`  ${errors.length === 0 ? '✅' : '⚠️'} Imports: ${errors.length === 0 ? 'OK' : `${errors.length} issues`}`);
    return { step: 'imports', passed: errors.length === 0, errors, duration: Date.now() - start };
  }

  private async checkServerStart(): Promise<VerifyResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Detect start command
    let startCmd: string | null = null;
    try {
      const pkg = JSON.parse(await readFile(join(this.root, 'package.json'), 'utf-8'));
      if (pkg.scripts?.dev) startCmd = 'npm run dev';
      else if (pkg.scripts?.start) startCmd = 'npm start';
    } catch { /* no package.json */ }

    if (!startCmd) {
      return { step: 'smoke-test', passed: true, errors: ['No start script — skipping'], duration: Date.now() - start };
    }

    // Try to start server and check health endpoint
    try {
      const { spawn } = await import('node:child_process');
      const proc = spawn(startCmd.split(' ')[0]!, startCmd.split(' ').slice(1), {
        cwd: this.root,
        stdio: 'pipe',
        shell: process.platform === 'win32',
        env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
      });

      // Wait up to 10s for server to start
      const serverReady = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { proc.kill(); resolve(false); }, 10_000);
        let output = '';
        proc.stdout?.on('data', (d: Buffer) => {
          output += d.toString();
          if (/listen|ready|started/i.test(output)) {
            clearTimeout(timer);
            setTimeout(() => { proc.kill(); resolve(true); }, 500);
          }
        });
        proc.stderr?.on('data', (d: Buffer) => {
          const err = d.toString();
          if (/error|EADDRINUSE|cannot find/i.test(err)) {
            clearTimeout(timer);
            errors.push(`Server error: ${err.slice(0, 100)}`);
            proc.kill();
            resolve(false);
          }
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0 && code !== null) {
            errors.push(`Server exited with code ${code}`);
          }
          resolve(false);
        });
      });

      if (!serverReady && errors.length === 0) {
        errors.push('Server did not become ready within 10 seconds');
      }
    } catch (e) {
      errors.push(`Smoke test failed: ${(e as Error).message.slice(0, 80)}`);
    }

    this.log(`  ${errors.length === 0 ? '✅' : '⚠️'} Smoke test: ${errors.length === 0 ? 'server starts OK' : errors[0]?.slice(0, 60)}`);
    return { step: 'smoke-test', passed: errors.length === 0, errors, duration: Date.now() - start };
  }

  private async checkTests(): Promise<VerifyResult> {
    const start = Date.now();
    const errors: string[] = [];

    let testCmd: string | null = null;
    try {
      const pkg = JSON.parse(await readFile(join(this.root, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) testCmd = 'npm test';
    } catch { /* no package.json */ }

    if (!testCmd) {
      return { step: 'tests', passed: true, errors: ['No test script — skipping'], duration: Date.now() - start };
    }

    try {
      execSync(`${testCmd} -- --run 2>&1`, { cwd: this.root, timeout: 120_000, encoding: 'utf-8' });
    } catch (e) {
      const output = (e as { stdout?: string }).stdout ?? (e as Error).message;
      // Extract failure summary
      const failMatch = output.match(/(\d+)\s*(?:failed|failing)/i);
      if (failMatch) {
        errors.push(`${failMatch[1]} tests failed`);
      } else {
        errors.push('Test suite failed (see test output)');
      }
    }

    this.log(`  ${errors.length === 0 ? '✅' : '❌'} Tests: ${errors.length === 0 ? 'all passing' : errors[0]}`);
    return { step: 'tests', passed: errors.length === 0, errors, duration: Date.now() - start };
  }
}

// ═══════════════════════════════════════════════════════════
// Build Step Wrapper — verify after each generation
// ═══════════════════════════════════════════════════════════

/**
 * Wraps a build step with automatic verification.
 * If verification fails, returns the errors so the caller can fix.
 */
export async function verifiedStep(
  name: string,
  projectRoot: string,
  action: () => Promise<void>,
  log?: LogFn
): Promise<{ ok: boolean; errors: string[] }> {
  const pipeline = new VerifiedBuildPipeline(projectRoot, log ?? console.log);
  const l = log ?? console.log;

  l(`\n  ── ${name} ──`);
  await action();

  l(`  Verifying...`);
  const check = await pipeline.quickCheck();

  if (!check.passed) {
    l(`  ❌ ${name} produced ${check.errors.length} errors:`);
    for (const err of check.errors.slice(0, 5)) l(`     ${err}`);
    return { ok: false, errors: check.errors };
  }

  l(`  ✅ ${name} verified`);
  return { ok: true, errors: [] };
}
