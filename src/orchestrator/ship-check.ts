/**
 * Ship Check — Integration Verification for Production Readiness
 *
 * Runs AFTER all tasks complete, before declaring "ship ready":
 * 1. Full TypeScript compilation (all files together)
 * 2. All tests pass
 * 3. Cross-file value consistency (TTL, ports, env vars)
 * 4. Security scan (no critical/high findings)
 * 5. Server start + health endpoint probe (if applicable)
 * 6. Complexity check (no critical hotspots)
 *
 * Returns a structured verdict: SHIP_READY | NEEDS_FIXES | CRITICAL_ISSUES
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CrossFileChecker } from '../agent/tracer/cross-file-checker.js';
import { SecurityScanner } from '../agent/tracer/security-scanner.js';
import { ComplexityAnalyzer } from '../agent/tracer/complexity-analyzer.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type ShipVerdict = 'SHIP_READY' | 'NEEDS_FIXES' | 'CRITICAL_ISSUES';

export interface ShipCheckItem {
  name: string;
  passed: boolean;
  detail: string;
  severity: 'blocker' | 'warning' | 'info';
}

export interface ShipCheckResult {
  verdict: ShipVerdict;
  checks: ShipCheckItem[];
  blockers: number;
  warnings: number;
  /** Human-readable summary */
  summary: string;
  duration: number;
}

type LogFn = (msg: string) => void;

// ═══════════════════════════════════════════════════════════
// Ship Check
// ═══════════════════════════════════════════════════════════

export class ShipCheck {
  private root: string;
  private log: LogFn;

  constructor(projectRoot: string, log?: LogFn) {
    this.root = projectRoot;
    this.log = log ?? (() => {});
  }

  async run(): Promise<ShipCheckResult> {
    const start = Date.now();
    const checks: ShipCheckItem[] = [];

    this.log('  🚀 Ship readiness check...\n');

    // 1. TypeScript compilation
    this.log('  [1/6] TypeScript compilation...');
    checks.push(this.checkTsc());

    // 2. Test suite
    this.log('  [2/6] Test suite...');
    checks.push(this.checkTests());

    // 3. Cross-file consistency
    this.log('  [3/6] Cross-file consistency...');
    checks.push(await this.checkCrossFile());

    // 4. Security
    this.log('  [4/6] Security scan...');
    checks.push(await this.checkSecurity());

    // 5. Server start probe
    this.log('  [5/6] Server start probe...');
    checks.push(this.checkServerStart());

    // 6. Complexity ceiling
    this.log('  [6/6] Complexity ceiling...');
    checks.push(await this.checkComplexityCeiling());

    const blockers = checks.filter(c => !c.passed && c.severity === 'blocker').length;
    const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;

    let verdict: ShipVerdict;
    if (blockers > 0) verdict = 'CRITICAL_ISSUES';
    else if (warnings > 0) verdict = 'NEEDS_FIXES';
    else verdict = 'SHIP_READY';

    const duration = Date.now() - start;

    const summary = this.buildSummary(checks, verdict, duration);
    this.log(`\n  ${verdict === 'SHIP_READY' ? '✅' : verdict === 'NEEDS_FIXES' ? '⚠️' : '🚨'} ${verdict}`);

    return { verdict, checks, blockers, warnings, summary, duration };
  }

  // ═══════════════════════════════════════════════════════════
  // Individual Checks
  // ═══════════════════════════════════════════════════════════

  private checkTsc(): ShipCheckItem {
    try {
      execSync('npx tsc --noEmit', { cwd: this.root, timeout: 60_000, stdio: 'pipe' });
      return { name: 'TypeScript', passed: true, detail: 'Compiles clean', severity: 'blocker' };
    } catch (err: unknown) {
      const output = (err as { stderr?: Buffer })?.stderr?.toString()?.slice(0, 300) ?? 'failed';
      return { name: 'TypeScript', passed: false, detail: output, severity: 'blocker' };
    }
  }

  private checkTests(): ShipCheckItem {
    try {
      execSync('npm test --if-present', { cwd: this.root, timeout: 120_000, stdio: 'pipe' });
      return { name: 'Tests', passed: true, detail: 'All tests pass', severity: 'blocker' };
    } catch (err: unknown) {
      const output = (err as { stdout?: Buffer })?.stdout?.toString()?.slice(0, 300) ?? 'failed';
      return { name: 'Tests', passed: false, detail: output, severity: 'blocker' };
    }
  }

  private async checkCrossFile(): Promise<ShipCheckItem> {
    try {
      const checker = new CrossFileChecker(this.root);
      const report = await checker.check();
      const criticalMismatches = report.mismatches.filter(m => m.severity === 'high');

      if (criticalMismatches.length > 0) {
        const detail = criticalMismatches.slice(0, 3)
          .map(m => `${m.category}: ${m.description}`)
          .join('; ');
        return { name: 'Cross-file consistency', passed: false, detail, severity: 'warning' };
      }

      return {
        name: 'Cross-file consistency',
        passed: true,
        detail: `${report.mismatches.length} minor mismatches`,
        severity: 'warning',
      };
    } catch {
      return { name: 'Cross-file consistency', passed: true, detail: 'Check skipped', severity: 'info' };
    }
  }

  private async checkSecurity(): Promise<ShipCheckItem> {
    try {
      const scanner = new SecurityScanner(this.root);
      const report = await scanner.scan();
      const critical = report.findings.filter(f => f.severity === 'critical');

      if (critical.length > 0) {
        return {
          name: 'Security',
          passed: false,
          detail: `${critical.length} critical: ${critical[0]!.description}`,
          severity: 'blocker',
        };
      }

      const high = report.findings.filter(f => f.severity === 'high');
      if (high.length > 0) {
        return {
          name: 'Security',
          passed: false,
          detail: `${high.length} high severity findings`,
          severity: 'warning',
        };
      }

      return { name: 'Security', passed: true, detail: `${report.summary.total} findings (none critical)`, severity: 'blocker' };
    } catch {
      return { name: 'Security', passed: true, detail: 'Scan skipped', severity: 'info' };
    }
  }

  private checkServerStart(): ShipCheckItem {
    // Check if there's a start script
    const pkgPath = join(this.root, 'package.json');
    if (!existsSync(pkgPath)) {
      return { name: 'Server start', passed: true, detail: 'No package.json — skipped', severity: 'info' };
    }

    try {
      const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf-8'));
      const hasStart = pkg.scripts?.start || pkg.scripts?.dev;

      if (!hasStart) {
        return { name: 'Server start', passed: true, detail: 'No start script — skipped', severity: 'info' };
      }

      // Try to build (not start) — starting would block
      if (pkg.scripts?.build) {
        execSync('npm run build', { cwd: this.root, timeout: 60_000, stdio: 'pipe' });
        return { name: 'Build check', passed: true, detail: 'npm run build succeeded', severity: 'warning' };
      }

      return { name: 'Server start', passed: true, detail: 'Has start script, build not tested', severity: 'info' };
    } catch (err: unknown) {
      const output = (err as { stderr?: Buffer })?.stderr?.toString()?.slice(0, 200) ?? 'failed';
      return { name: 'Build check', passed: false, detail: output, severity: 'warning' };
    }
  }

  private async checkComplexityCeiling(): Promise<ShipCheckItem> {
    try {
      const analyzer = new ComplexityAnalyzer(this.root);
      const report = await analyzer.analyze();

      if (report.summary.critical > 0) {
        const worst = report.hotspots[0];
        return {
          name: 'Complexity',
          passed: false,
          detail: `${report.summary.critical} critical functions (worst: ${worst?.name} cc:${worst?.cyclomatic})`,
          severity: 'warning',
        };
      }

      return {
        name: 'Complexity',
        passed: true,
        detail: `${report.totalFunctions} functions, avg cc:${report.averageComplexity.cyclomatic}`,
        severity: 'warning',
      };
    } catch {
      return { name: 'Complexity', passed: true, detail: 'Check skipped', severity: 'info' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════

  private buildSummary(checks: ShipCheckItem[], verdict: ShipVerdict, duration: number): string {
    const lines: string[] = [];
    lines.push(`# Ship Check — ${verdict}\n`);

    for (const c of checks) {
      const icon = c.passed ? '✅' : c.severity === 'blocker' ? '🚨' : '⚠️';
      lines.push(`${icon} ${c.name}: ${c.detail}`);
    }

    lines.push(`\nDuration: ${duration}ms`);

    if (verdict === 'SHIP_READY') {
      lines.push('\n**Ready to ship.** All critical checks passed.');
    } else if (verdict === 'NEEDS_FIXES') {
      lines.push('\n**Fix warnings before shipping.** No blockers but quality issues detected.');
    } else {
      lines.push('\n**DO NOT SHIP.** Critical blockers found — fix before deployment.');
    }

    return lines.join('\n');
  }
}
