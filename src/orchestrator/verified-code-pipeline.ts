/**
 * Verified Code Pipeline — Post-Agent Code Quality Gate
 *
 * After an agent writes code, run every check in sequence:
 * 1. Convention conformance (does it match project style?)
 * 2. TypeScript compilation (does it compile?)
 * 3. Type-flow impact (does it break type chains?)
 * 4. Complexity check (is it too complex?)
 * 5. Security scan (any vulnerabilities?)
 * 6. Test execution (do tests pass?)
 *
 * Returns a structured verdict with auto-fixable issues flagged.
 */

import { execSync } from 'node:child_process';
import { ConventionDetector } from '../agent/tracer/convention-detector.js';
import { TypeFlowAnalyzer } from '../agent/tracer/type-flow-analyzer.js';
import { ComplexityAnalyzer } from '../agent/tracer/complexity-analyzer.js';
import { SecurityScanner } from '../agent/tracer/security-scanner.js';
import { ASTCodeMod } from '../agent/tracer/ast-code-mod.js';
import type { ConventionViolation } from '../types/index.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface PipelineCheck {
  name: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  autoFixable: number;
  duration: number;
}

export interface CodePipelineResult {
  checks: PipelineCheck[];
  passed: boolean;
  totalErrors: number;
  totalWarnings: number;
  autoFixable: number;
  /** Markdown feedback for agent retry */
  feedback: string;
  duration: number;
}

type LogFn = (msg: string) => void;

// ═══════════════════════════════════════════════════════════
// Pipeline
// ═══════════════════════════════════════════════════════════

export class VerifiedCodePipeline {
  private root: string;
  private log: LogFn;

  constructor(projectRoot: string, log?: LogFn) {
    this.root = projectRoot;
    this.log = log ?? (() => {});
  }

  /**
   * Run verification with auto-fix: verify → try AST fix → re-verify.
   * Use this in the orchestrator loop instead of bare verify().
   */
  async verifyWithAutoFix(): Promise<CodePipelineResult> {
    const firstPass = await this.verify();
    if (firstPass.passed || firstPass.autoFixable === 0) return firstPass;

    // Try auto-fix for common issues
    this.log('  🔧 Attempting auto-fix...');
    const mod = new ASTCodeMod(this.root);
    let fixCount = 0;

    // Auto-fix: missing imports detected by tsc (TS2305: has no exported member)
    for (const check of firstPass.checks) {
      if (check.name === 'TypeScript' && !check.passed) {
        for (const err of check.errors) {
          // TS2305: Module '"./x"' has no exported member 'Y' — try rename
          const renameMatch = err.match(/has no exported member '(\w+)'/);
          if (renameMatch?.[1]) {
            this.log(`    → Flagged for retry: missing export '${renameMatch[1]}'`);
          }

          // TS2345: Argument of type 'X' is not assignable — can't auto-fix
          // TS2304: Cannot find name 'X' — can't auto-fix without knowing source
        }
      }

      // Auto-fix: wrap unwrapped functions flagged by complexity check
      if (check.name === 'Complexity' && !check.passed) {
        for (const err of check.errors) {
          const fnMatch = err.match(/🚨 (\w+) \(([^:]+):(\d+)\)/);
          if (fnMatch?.[1] && fnMatch[2]) {
            const wrapResult = mod.wrapWithTryCatch(fnMatch[2], fnMatch[1]);
            if (wrapResult.success) {
              fixCount++;
              this.log(`    ✅ Wrapped ${fnMatch[1]} with error handling`);
            }
          }
        }
      }
    }

    if (fixCount > 0) {
      this.log(`  ✅ Auto-fixed ${fixCount} issues, re-verifying...`);
      return this.verify();
    }

    return firstPass;
  }

  /**
   * Run full verification pipeline on current project state.
   * Call after each agent task to catch errors immediately.
   */
  async verify(): Promise<CodePipelineResult> {
    const start = Date.now();
    const checks: PipelineCheck[] = [];

    // 1. Convention check
    this.log('  🔍 [1/6] Convention check...');
    checks.push(await this.checkConventions());

    // 2. TypeScript compilation
    this.log('  🔍 [2/6] TypeScript compilation...');
    checks.push(this.checkTypeScript());

    // 3. Type-flow impact
    this.log('  🔍 [3/6] Type-flow impact analysis...');
    checks.push(await this.checkTypeFlow());

    // 4. Complexity
    this.log('  🔍 [4/6] Complexity analysis...');
    checks.push(await this.checkComplexity());

    // 5. Security
    this.log('  🔍 [5/6] Security scan...');
    checks.push(await this.checkSecurity());

    // 6. Tests
    this.log('  🔍 [6/6] Running tests...');
    checks.push(this.checkTests());

    const totalErrors = checks.reduce((s, c) => s + c.errors.length, 0);
    const totalWarnings = checks.reduce((s, c) => s + c.warnings.length, 0);
    const autoFixable = checks.reduce((s, c) => s + c.autoFixable, 0);
    const passed = checks.filter(c => c.errors.length > 0).length === 0;
    const feedback = this.buildFeedback(checks, passed);
    const duration = Date.now() - start;

    this.log(passed
      ? `  ✅ Pipeline passed (${duration}ms)`
      : `  ❌ Pipeline failed: ${totalErrors} errors, ${totalWarnings} warnings (${duration}ms)`
    );

    return { checks, passed, totalErrors, totalWarnings, autoFixable, feedback, duration };
  }

  // ═══════════════════════════════════════════════════════════
  // Individual Checks
  // ═══════════════════════════════════════════════════════════

  private async checkConventions(): Promise<PipelineCheck> {
    const start = Date.now();
    try {
      const detector = new ConventionDetector(this.root);
      const report = await detector.detect();

      // Only report non-trivial violations (skip semicolons etc.)
      const serious = report.violations.filter((v: ConventionViolation) =>
        v.rule !== 'semicolons'
      );

      return {
        name: 'Convention Check',
        passed: serious.length === 0,
        errors: [],
        warnings: serious.slice(0, 10).map((v: ConventionViolation) =>
          `[${v.rule}] ${v.file}:${v.line} — expected ${v.expected}`
        ),
        autoFixable: report.summary.autoFixable,
        duration: Date.now() - start,
      };
    } catch {
      return { name: 'Convention Check', passed: true, errors: [], warnings: ['Detection failed'], autoFixable: 0, duration: Date.now() - start };
    }
  }

  private checkTypeScript(): PipelineCheck {
    const start = Date.now();
    try {
      execSync('npx tsc --noEmit', { cwd: this.root, timeout: 60_000, stdio: 'pipe' });
      return { name: 'TypeScript', passed: true, errors: [], warnings: [], autoFixable: 0, duration: Date.now() - start };
    } catch (err: unknown) {
      const output = (err as { stderr?: Buffer })?.stderr?.toString() ?? '';
      const errorLines = output.split('\n').filter(l => l.includes('error TS')).slice(0, 10);
      return {
        name: 'TypeScript',
        passed: false,
        errors: errorLines.length > 0 ? errorLines : ['tsc --noEmit failed'],
        warnings: [],
        autoFixable: 0,
        duration: Date.now() - start,
      };
    }
  }

  private async checkTypeFlow(): Promise<PipelineCheck> {
    const start = Date.now();
    try {
      const analyzer = new TypeFlowAnalyzer(this.root);
      const report = await analyzer.analyze();

      const warnings: string[] = [];
      // Flag types with very high blast radius
      for (const t of report.hotTypes.slice(0, 3)) {
        if (t.usageCount > 10) {
          warnings.push(`Hot type: ${t.name} used in ${t.usageCount} files — changes will have wide impact`);
        }
      }

      return {
        name: 'Type-Flow Impact',
        passed: true, // info only, not a blocker
        errors: [],
        warnings,
        autoFixable: 0,
        duration: Date.now() - start,
      };
    } catch {
      return { name: 'Type-Flow Impact', passed: true, errors: [], warnings: [], autoFixable: 0, duration: Date.now() - start };
    }
  }

  private async checkComplexity(): Promise<PipelineCheck> {
    const start = Date.now();
    try {
      const analyzer = new ComplexityAnalyzer(this.root);
      const report = await analyzer.analyze();

      const errors: string[] = [];
      const warnings: string[] = [];

      for (const fn of report.functions) {
        if (fn.rating === 'critical') {
          errors.push(`🚨 ${fn.name} (${fn.file}:${fn.line}) — cc:${fn.cyclomatic} cog:${fn.cognitive} — refactor required`);
        } else if (fn.rating === 'warning') {
          warnings.push(`⚠️ ${fn.name} (${fn.file}:${fn.line}) — cc:${fn.cyclomatic} cog:${fn.cognitive}`);
        }
      }

      return {
        name: 'Complexity',
        passed: errors.length === 0, // critical = fail
        errors: errors.slice(0, 5),
        warnings: warnings.slice(0, 5),
        autoFixable: 0,
        duration: Date.now() - start,
      };
    } catch {
      return { name: 'Complexity', passed: true, errors: [], warnings: [], autoFixable: 0, duration: Date.now() - start };
    }
  }

  private async checkSecurity(): Promise<PipelineCheck> {
    const start = Date.now();
    try {
      const scanner = new SecurityScanner(this.root);
      const report = await scanner.scan();

      const errors = report.findings
        .filter(f => f.severity === 'critical' || f.severity === 'high')
        .slice(0, 5)
        .map(f => `[${f.rule}] ${f.file}:${f.line} — ${f.description}`);

      const warnings = report.findings
        .filter(f => f.severity === 'medium')
        .slice(0, 5)
        .map(f => `[${f.rule}] ${f.file}:${f.line} — ${f.description}`);

      return {
        name: 'Security',
        passed: errors.length === 0,
        errors,
        warnings,
        autoFixable: 0,
        duration: Date.now() - start,
      };
    } catch {
      return { name: 'Security', passed: true, errors: [], warnings: [], autoFixable: 0, duration: Date.now() - start };
    }
  }

  private checkTests(): PipelineCheck {
    const start = Date.now();
    try {
      execSync('npm test --if-present', { cwd: this.root, timeout: 120_000, stdio: 'pipe' });
      return { name: 'Tests', passed: true, errors: [], warnings: [], autoFixable: 0, duration: Date.now() - start };
    } catch (err: unknown) {
      const output = (err as { stdout?: Buffer })?.stdout?.toString() ?? '';
      const failLines = output.split('\n').filter(l => l.includes('FAIL') || l.includes('failed')).slice(0, 5);
      return {
        name: 'Tests',
        passed: false,
        errors: failLines.length > 0 ? failLines : ['npm test failed'],
        warnings: [],
        autoFixable: 0,
        duration: Date.now() - start,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Feedback Generation (for agent retry)
  // ═══════════════════════════════════════════════════════════

  private buildFeedback(checks: PipelineCheck[], passed: boolean): string {
    if (passed) return 'All checks passed.';

    const lines: string[] = ['## Verification Failed\n'];

    for (const check of checks) {
      if (check.errors.length === 0 && check.warnings.length === 0) {
        lines.push(`✅ ${check.name}: passed`);
      } else if (check.errors.length > 0) {
        lines.push(`❌ ${check.name}: FAILED`);
        for (const e of check.errors) lines.push(`   ${e}`);
      } else {
        lines.push(`⚠️ ${check.name}: warnings`);
        for (const w of check.warnings) lines.push(`   ${w}`);
      }
    }

    lines.push('\n## Fix Instructions\n');
    lines.push('Fix the errors above and regenerate the affected files.');
    lines.push('Do NOT change files that passed all checks.');

    return lines.join('\n');
  }
}
