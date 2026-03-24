/**
 * PR Review — Targeted Audit on Changed Files
 *
 * Takes a git diff (staged, unstaged, or specific commit range),
 * identifies changed files + their dependents, runs targeted
 * security scan + architecture check, outputs PR-comment-ready markdown.
 *
 * Usage:
 *   csns review              → reviews staged changes
 *   csns review --all        → reviews all uncommitted changes
 *   csns review --commit HEAD~3..HEAD  → reviews commit range
 */

import { execSync } from 'node:child_process';
import { StaticAnalyzer } from '../agent/tracer/static-analyzer.js';
import { SecurityScanner } from '../agent/tracer/security-scanner.js';
import { ReverseEngineer } from '../agent/tracer/reverse-engineer.js';
import type { LLMProvider } from '../llm/types.js';
import type { SecurityFinding } from '../agent/tracer/security-scanner.js';
import type { ArchitectureViolation } from '../agent/tracer/reverse-engineer.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ReviewResult {
  /** Changed files detected from git */
  changedFiles: string[];
  /** Files impacted by the changes (dependents) */
  impactedFiles: string[];
  /** Security findings in changed files */
  securityFindings: SecurityFinding[];
  /** Architecture violations in changed files */
  architectureViolations: ArchitectureViolation[];
  /** Summary stats */
  summary: {
    filesChanged: number;
    filesImpacted: number;
    securityIssues: number;
    archViolations: number;
    verdict: 'approve' | 'request-changes' | 'comment';
  };
  /** PR-comment-ready markdown */
  markdown: string;
  duration: number;
}

export type ReviewScope = 'staged' | 'all' | 'commit';

// ═══════════════════════════════════════════════════════════
// Reviewer
// ═══════════════════════════════════════════════════════════

export class PRReviewer {
  private projectRoot: string;
  private provider: LLMProvider | null;

  constructor(projectRoot: string, provider?: LLMProvider | null) {
    this.projectRoot = projectRoot;
    this.provider = provider ?? null;
  }

  /**
   * Review changes based on scope.
   */
  async review(scope: ReviewScope = 'staged', commitRange?: string): Promise<ReviewResult> {
    const start = Date.now();

    // 1. Get changed files from git
    const changedFiles = this.getChangedFiles(scope, commitRange);

    if (changedFiles.length === 0) {
      return this.emptyResult(start);
    }

    // 2. Find impacted files (dependents of changed files)
    const impactedFiles = await this.findImpactedFiles(changedFiles);

    // 3. Security scan — only on changed files
    const securityFindings = await this.scanSecurity(changedFiles);

    // 4. Architecture check — changed + impacted
    const allRelevant = [...new Set([...changedFiles, ...impactedFiles])];
    const archViolations = await this.checkArchitecture(allRelevant);

    // 5. Determine verdict
    const hasCritical = securityFindings.some(f => f.severity === 'critical') ||
      archViolations.some(v => v.severity === 'critical' && !v.acknowledged);
    const hasWarning = securityFindings.some(f => f.severity === 'high' || f.severity === 'medium') ||
      archViolations.some(v => v.severity === 'warning' && !v.acknowledged);

    const verdict: ReviewResult['summary']['verdict'] =
      hasCritical ? 'request-changes' :
      hasWarning ? 'comment' : 'approve';

    // 6. Generate markdown
    const markdown = this.generateMarkdown(
      changedFiles, impactedFiles, securityFindings, archViolations, verdict
    );

    return {
      changedFiles,
      impactedFiles,
      securityFindings,
      architectureViolations: archViolations,
      summary: {
        filesChanged: changedFiles.length,
        filesImpacted: impactedFiles.length,
        securityIssues: securityFindings.length,
        archViolations: archViolations.filter(v => !v.acknowledged).length,
        verdict,
      },
      markdown,
      duration: Date.now() - start,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Git Integration
  // ═══════════════════════════════════════════════════════════

  private getChangedFiles(scope: ReviewScope, commitRange?: string): string[] {
    let cmd: string;
    switch (scope) {
      case 'staged':
        cmd = 'git diff --cached --name-only --diff-filter=ACMR';
        break;
      case 'all':
        cmd = 'git diff --name-only --diff-filter=ACMR HEAD';
        break;
      case 'commit':
        cmd = `git diff --name-only --diff-filter=ACMR ${commitRange ?? 'HEAD~1..HEAD'}`;
        break;
    }

    try {
      const output = execSync(cmd, { cwd: this.projectRoot, encoding: 'utf-8', timeout: 10_000 });
      return output.trim().split('\n')
        .filter(f => f.length > 0)
        .filter(f => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Impact Analysis
  // ═══════════════════════════════════════════════════════════

  private async findImpactedFiles(changedFiles: string[]): Promise<string[]> {
    const analyzer = new StaticAnalyzer(this.projectRoot);
    const { edges } = await analyzer.buildGraph();

    const impacted = new Set<string>();
    const changedSet = new Set(changedFiles);

    // Find files that import any changed file (reverse edges)
    for (const edge of edges) {
      if (changedSet.has(edge.target) && !changedSet.has(edge.source)) {
        impacted.add(edge.source);
      }
    }

    // Second level — files that import the impacted files
    for (const edge of edges) {
      if (impacted.has(edge.target) && !changedSet.has(edge.source) && !impacted.has(edge.source)) {
        impacted.add(edge.source);
      }
    }

    return [...impacted];
  }

  // ═══════════════════════════════════════════════════════════
  // Targeted Scans
  // ═══════════════════════════════════════════════════════════

  private async scanSecurity(files: string[]): Promise<SecurityFinding[]> {
    const scanner = new SecurityScanner(this.projectRoot);
    const report = await scanner.scan();
    // Filter to only findings in changed files
    return report.findings.filter(f => files.some(cf => f.file.includes(cf) || cf.includes(f.file)));
  }

  private async checkArchitecture(files: string[]): Promise<ArchitectureViolation[]> {
    const auditor = new ReverseEngineer(this.projectRoot, this.provider);
    const report = await auditor.audit();
    // Filter to only violations in relevant files
    return report.violations.filter(v =>
      files.some(f => v.file.includes(f) || f.includes(v.file) || v.file === 'project-wide')
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Markdown Generation
  // ═══════════════════════════════════════════════════════════

  private generateMarkdown(
    changed: string[],
    impacted: string[],
    security: SecurityFinding[],
    arch: ArchitectureViolation[],
    verdict: ReviewResult['summary']['verdict']
  ): string {
    const parts: string[] = [];

    // Header
    const verdictIcon = verdict === 'approve' ? '✅' : verdict === 'request-changes' ? '🚨' : '💬';
    const verdictText = verdict === 'approve' ? 'LGTM — No issues found' :
      verdict === 'request-changes' ? 'Changes requested — critical issues found' :
      'Comments — minor issues to review';
    parts.push(`## ${verdictIcon} CSNS Review: ${verdictText}\n`);

    // Summary
    parts.push(`| Metric | Count |`);
    parts.push(`|--------|-------|`);
    parts.push(`| Files changed | ${changed.length} |`);
    parts.push(`| Files impacted | ${impacted.length} |`);
    parts.push(`| Security findings | ${security.length} |`);
    parts.push(`| Architecture issues | ${arch.filter(v => !v.acknowledged).length} |`);
    parts.push('');

    // Changed files
    parts.push(`### 📁 Changed Files\n`);
    for (const f of changed) parts.push(`- \`${f}\``);
    parts.push('');

    // Impact
    if (impacted.length > 0) {
      parts.push(`### 🔗 Impacted Files (dependents)\n`);
      for (const f of impacted.slice(0, 15)) parts.push(`- \`${f}\``);
      if (impacted.length > 15) parts.push(`- ... +${impacted.length - 15} more`);
      parts.push('');
    }

    // Security findings
    if (security.length > 0) {
      parts.push(`### 🔒 Security Findings\n`);
      for (const f of security) {
        const icon = f.severity === 'critical' ? '🚨' : f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🟢';
        parts.push(`${icon} **[${f.rule}]** ${f.severity.toUpperCase()} — \`${f.file}:${f.line}\``);
        parts.push(`> ${f.description}`);
        parts.push(`> **Fix:** ${f.fix}`);
        parts.push(`> \`\`\`\n> ${f.code.slice(0, 120)}\n> \`\`\``);
        parts.push('');
      }
    }

    // Architecture violations (unacknowledged only)
    const realArch = arch.filter(v => !v.acknowledged);
    if (realArch.length > 0) {
      parts.push(`### 🏗️ Architecture Issues\n`);
      for (const v of realArch) {
        const icon = v.severity === 'critical' ? '🚨' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
        parts.push(`${icon} **[${v.type}]** — \`${v.file}\``);
        parts.push(`> ${v.description}`);
        parts.push(`> **Expected:** ${v.expectedBehavior}`);
        parts.push('');
      }
    }

    // Acknowledged (collapsed)
    const acked = arch.filter(v => v.acknowledged);
    if (acked.length > 0) {
      parts.push(`<details><summary>✅ ${acked.length} acknowledged design decisions (not bugs)</summary>\n`);
      for (const v of acked) {
        parts.push(`- **${v.description.slice(0, 80)}** — ${v.acknowledgeReason ?? 'design decision'}`);
      }
      parts.push(`\n</details>\n`);
    }

    return parts.join('\n');
  }

  private emptyResult(start: number): ReviewResult {
    return {
      changedFiles: [],
      impactedFiles: [],
      securityFindings: [],
      architectureViolations: [],
      summary: {
        filesChanged: 0,
        filesImpacted: 0,
        securityIssues: 0,
        archViolations: 0,
        verdict: 'approve',
      },
      markdown: '## ✅ CSNS Review: No changes to review\n\nNo staged TypeScript/JavaScript files found.\n',
      duration: Date.now() - start,
    };
  }
}
