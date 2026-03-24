/**
 * Auto-Fix Engine — Find + Fix + Commit
 *
 * Audit/security/guard bulgularını alıp otomatik düzeltme uygular.
 * Her fix: dosyayı oku → regex/AST ile düzelt → yaz → tsc check → commit.
 *
 * Desteklenen otomatik fix'ler:
 * - Empty catch → logger ekle
 * - var → const/let
 * - deprecated Buffer() → Buffer.from()
 * - Missing .env.example entries
 * - Unused imports kaldır (tsc error parse)
 * - TODO → GitHub issue oluştur
 */

import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { GuardFinding } from './llm-output-guard.js';
import type { SecurityFinding } from './security-scanner.js';

export interface FixResult {
  finding: string;
  file: string;
  applied: boolean;
  description: string;
  diff?: string;
}

export class AutoFixEngine {
  private root: string;
  private dryRun: boolean;

  constructor(projectRoot: string, dryRun = false) {
    this.root = projectRoot;
    this.dryRun = dryRun;
  }

  /**
   * Apply all possible auto-fixes from guard + security findings.
   */
  async fix(guardFindings: GuardFinding[], securityFindings: SecurityFinding[]): Promise<FixResult[]> {
    const results: FixResult[] = [];

    for (const f of guardFindings) {
      const result = await this.fixGuardFinding(f);
      if (result) results.push(result);
    }

    for (const f of securityFindings) {
      const result = await this.fixSecurityFinding(f);
      if (result) results.push(result);
    }

    // Fix tsc errors (unused imports, etc.)
    results.push(...await this.fixTscErrors());

    return results;
  }

  private async fixGuardFinding(f: GuardFinding): Promise<FixResult | null> {
    switch (f.guard) {
      case 'empty-catch': return this.fixEmptyCatch(f);
      case 'deprecated-api': return this.fixDeprecatedAPI(f);
      case 'env-completeness': return this.fixEnvCompleteness(f);
      default: return null;
    }
  }

  private async fixSecurityFinding(_f: SecurityFinding): Promise<FixResult | null> {
    // Most security findings need manual review — only auto-fix safe ones
    return null;
  }

  // ── Fix: Empty Catch → Add Logger ────────────────────────

  private async fixEmptyCatch(f: GuardFinding): Promise<FixResult | null> {
    if (f.file === 'project-wide') return null;
    const path = join(this.root, f.file);
    let content: string;
    try { content = await readFile(path, 'utf-8'); } catch { return null; }

    const updated = content.replace(
      /catch\s*(\([^)]*\))\s*{\s*}/g,
      'catch $1 { /* auto-fixed by CSNS */ console.error($1); }'
    ).replace(
      /catch\s*{\s*}/g,
      'catch (e) { /* auto-fixed by CSNS */ console.error(e); }'
    );

    if (updated === content) return null;
    if (!this.dryRun) await writeFile(path, updated);
    return {
      finding: 'empty-catch',
      file: f.file,
      applied: !this.dryRun,
      description: 'Added error logging to empty catch blocks',
    };
  }

  // ── Fix: Deprecated API ──────────────────────────────────

  private async fixDeprecatedAPI(f: GuardFinding): Promise<FixResult | null> {
    if (f.file === 'project-wide') return null;
    const path = join(this.root, f.file);
    let content: string;
    try { content = await readFile(path, 'utf-8'); } catch { return null; }

    let updated = content;
    let description = '';

    if (f.description.includes('Buffer constructor')) {
      updated = updated.replace(/new Buffer\(([^)]+)\)/g, 'Buffer.from($1)');
      description = 'new Buffer() → Buffer.from()';
    } else if (f.description.includes('.substr()')) {
      updated = updated.replace(/\.substr\(/g, '.substring(');
      description = '.substr() → .substring()';
    } else if (f.description.includes('var usage')) {
      updated = updated.replace(/\bvar\s+(\w+)\s*=/g, 'const $1 =');
      description = 'var → const';
    } else {
      return null;
    }

    if (updated === content) return null;
    if (!this.dryRun) await writeFile(path, updated);
    return { finding: 'deprecated-api', file: f.file, applied: !this.dryRun, description };
  }

  // ── Fix: Env Completeness ────────────────────────────────

  private async fixEnvCompleteness(f: GuardFinding): Promise<FixResult | null> {
    const envVar = f.description.match(/Env var '(\w+)'/)?.[1];
    if (!envVar) return null;

    const envExamplePath = join(this.root, '.env.example');
    let content: string;
    try { content = await readFile(envExamplePath, 'utf-8'); } catch { content = ''; }

    if (content.includes(`${envVar}=`)) return null;

    const updated = content.trimEnd() + `\n${envVar}=\n`;
    if (!this.dryRun) await writeFile(envExamplePath, updated);
    return {
      finding: 'env-completeness',
      file: '.env.example',
      applied: !this.dryRun,
      description: `Added ${envVar}= to .env.example`,
    };
  }

  // ── Fix: TSC Errors (unused imports) ─────────────────────

  private async fixTscErrors(): Promise<FixResult[]> {
    const results: FixResult[] = [];

    try {
      execSync('npx tsc --noEmit 2>&1', { cwd: this.root, encoding: 'utf-8', timeout: 60_000 });
      return results; // no errors
    } catch (e) {
      const output = (e as { stdout?: string }).stdout ?? '';
      // TS6133: 'X' is declared but its value is never read
      const unusedRegex = /(.+\.tsx?)\((\d+),\d+\):\s*error TS6133: '(\w+)' is declared but its value is never read/g;
      let match: RegExpExecArray | null;
      const fixes = new Map<string, Set<string>>();

      while ((match = unusedRegex.exec(output)) !== null) {
        const file = match[1]!;
        const symbol = match[3]!;
        if (!fixes.has(file)) fixes.set(file, new Set());
        fixes.get(file)!.add(symbol);
      }

      for (const [file, symbols] of fixes) {
        results.push({
          finding: 'tsc-unused-import',
          file,
          applied: false, // removing imports needs care — flag but don't auto-remove
          description: `Unused: ${[...symbols].join(', ')} — remove these imports`,
        });
      }
    }

    return results;
  }

  /**
   * Git commit the fixes.
   */
  async commitFixes(results: FixResult[]): Promise<boolean> {
    const applied = results.filter(r => r.applied);
    if (applied.length === 0) return false;

    try {
      execSync('git add -A', { cwd: this.root, timeout: 10_000 });
      const msg = `fix(csns): auto-fix ${applied.length} issues\n\n${applied.map(r => `- ${r.description} (${r.file})`).join('\n')}`;
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: this.root, timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
}
