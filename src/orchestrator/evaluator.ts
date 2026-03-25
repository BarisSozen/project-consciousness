/**
 * Orchestrator — Evaluator (v3)
 * 
 * Two-layer evaluation:
 * 1. Real checks: run tsc/npm test/pytest/go build based on stack
 * 2. Anti-scope check: enforce MISSION.md constraints
 * 3. LLM evaluation: consistency, quality, mission alignment (optional)
 * 
 * Now uses LLMProvider abstraction + i18n.
 */

import { exec } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '../llm/types.js';
import { resolveProvider } from '../llm/resolve.js';
import { t } from '../i18n/index.js';
import { BriefCollector } from '../brief/brief-collector.js';
import type { 
  RealEvaluationResult,
  CheckResult,
  AntiScopeViolation,
  AgentResult, 
  MemorySnapshot,
  OrchestratorConfig,
  StackType,
  ConsistencyIssue,
} from '../types/index.js';

// ── Stack-specific check definitions ────────────────────────

interface StackCheck {
  name: string;
  command: string;
  required: boolean;
}

const STACK_CHECKS: Record<StackType, StackCheck[]> = {
  'typescript-node': [
    { name: 'TypeScript compile', command: 'npx tsc --noEmit', required: true },
    { name: 'Unit tests', command: 'npm test', required: true },
    { name: 'Lint', command: 'npx eslint src/ --quiet', required: false },
  ],
  'react': [
    { name: 'TypeScript compile', command: 'npx tsc --noEmit', required: true },
    { name: 'Unit tests', command: 'npm test', required: true },
    { name: 'Build', command: 'npm run build', required: true },
    { name: 'Lint', command: 'npx eslint src/ --quiet', required: false },
  ],
  'python': [
    { name: 'Pytest', command: 'pytest', required: true },
    { name: 'Type check', command: 'mypy .', required: false },
    { name: 'Lint', command: 'flake8', required: false },
  ],
  'go': [
    { name: 'Go build', command: 'go build ./...', required: true },
    { name: 'Go test', command: 'go test ./...', required: true },
    { name: 'Go vet', command: 'go vet ./...', required: false },
  ],
  'other': [],
};

export class Evaluator {
  private provider: LLMProvider | null;
  private escalationThreshold: number;
  private projectRoot: string;

  constructor(config: OrchestratorConfig) {
    this.provider = resolveProvider(config);
    this.escalationThreshold = config.escalationThreshold;
    this.projectRoot = config.projectRoot;
  }

  /**
   * Full evaluation: real checks + anti-scope + LLM
   */
  async evaluate(
    agentResult: AgentResult,
    memory: MemorySnapshot
  ): Promise<RealEvaluationResult> {
    // 1. Stack detection
    const stackDetected = await this.detectStack(memory);

    // 2. Run real checks
    const checks = await this.runStackChecks(stackDetected, agentResult.artifacts);

    // 3. Anti-scope check
    const antiScopeViolations = this.checkAntiScope(agentResult, memory);

    // 3b. Mandatory test check — code tasks must produce test files
    const testIssue = this.checkMandatoryTests(agentResult);
    if (testIssue) {
      antiScopeViolations.push(testIssue);
    }

    // 4. Compute scores
    const scores = this.computeScores(checks, antiScopeViolations, agentResult);

    // 5. Build issues
    const issues = this.buildIssues(checks, antiScopeViolations);

    // 6. LLM evaluation (optional)
    let llmFeedback: string | undefined;
    if (this.provider) {
      try {
        const llmResult = await this.llmEvaluate(agentResult, memory);
        llmFeedback = llmResult.feedback;
        issues.push(...llmResult.issues);
      } catch {
        llmFeedback = 'LLM evaluation failed — real checks only.';
      }
    }

    const result: RealEvaluationResult = {
      taskId: agentResult.taskId,
      consistencyScore: scores.consistency,
      qualityScore: scores.quality,
      missionAlignment: scores.mission,
      issues,
      verdict: 'accept',
      feedback: this.buildFeedback(checks, antiScopeViolations, llmFeedback),
      checks,
      antiScopeViolations,
      stackDetected,
    };

    return this.applyThresholds(result);
  }

  // ── Stack Detection ─────────────────────────────────────

  async detectStack(memory: MemorySnapshot): Promise<StackType> {
    const missionStack = BriefCollector.parseStackType(memory.files.mission);
    if (missionStack) return missionStack;

    const indicators: Array<{ file: string; stack: StackType }> = [
      { file: 'tsconfig.json', stack: 'typescript-node' },
      { file: 'package.json', stack: 'typescript-node' },
      { file: 'requirements.txt', stack: 'python' },
      { file: 'pyproject.toml', stack: 'python' },
      { file: 'go.mod', stack: 'go' },
    ];

    for (const { file, stack } of indicators) {
      try {
        await access(join(this.projectRoot, file));
        if (file === 'package.json' && stack === 'typescript-node') {
          try {
            const pkg = await readFile(join(this.projectRoot, 'package.json'), 'utf-8');
            if (pkg.includes('"react"')) return 'react';
          } catch { /* ignore */ }
        }
        return stack;
      } catch { /* file not found, continue */ }
    }

    return 'other';
  }

  // ── Real Stack Checks ──────────────────────────────────

  async runStackChecks(
    stack: StackType,
    agentArtifacts: string[] = []
  ): Promise<CheckResult[]> {
    const checks = STACK_CHECKS[stack] ?? [];
    const results: CheckResult[] = [];

    for (const check of checks) {
      const command = this.resolveCommand(check, agentArtifacts);

      if (check.name.includes('Lint')) {
        const lintResult = await this.runLintCheck(check.name, command);
        results.push(lintResult);
        continue;
      }

      const result = await this.runCommand(check.name, command);
      results.push(result);
    }

    // Memory file existence checks
    results.push(await this.checkFileExists('MISSION.md'));
    results.push(await this.checkFileExists('ARCHITECTURE.md'));
    results.push(await this.checkFileExists('DECISIONS.md'));
    results.push(await this.checkFileExists('STATE.md'));

    return results;
  }

  private resolveCommand(check: StackCheck, artifacts: string[]): string {
    if (!check.name.toLowerCase().includes('test')) {
      return check.command;
    }

    const testFiles = artifacts.filter(a =>
      a.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) ||
      a.startsWith('tests/') ||
      a.startsWith('test/')
    );

    if (testFiles.length === 0) {
      return check.command;
    }

    if (check.command.includes('vitest') || check.command.includes('npm test')) {
      return `npx vitest run ${testFiles.join(' ')}`;
    }
    if (check.command.includes('pytest')) {
      return `pytest ${testFiles.join(' ')}`;
    }

    return check.command;
  }

  private async runLintCheck(name: string, command: string): Promise<CheckResult> {
    const eslintConfigs = [
      'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
      '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc',
    ];

    let hasConfig = false;
    for (const cfg of eslintConfigs) {
      try {
        await access(join(this.projectRoot, cfg));
        hasConfig = true;
        break;
      } catch { /* not found */ }
    }

    if (command.includes('flake8')) {
      try {
        await access(join(this.projectRoot, '.flake8'));
        hasConfig = true;
      } catch {
        try {
          await access(join(this.projectRoot, 'setup.cfg'));
          hasConfig = true;
        } catch { /* not found */ }
      }
    }

    if (!hasConfig) {
      return {
        name,
        command,
        passed: true,
        output: 'SKIPPED — lint config not found, skipping check',
      };
    }

    return this.runCommand(name, command);
  }

  private runCommand(name: string, command: string): Promise<CheckResult> {
    const start = Date.now();
    return new Promise((resolve) => {
      exec(command, { cwd: this.projectRoot, timeout: 60_000 }, (error, stdout, stderr) => {
        resolve({
          name,
          command,
          passed: !error,
          output: error 
            ? `${stderr || stdout}`.slice(0, 500)
            : `OK (${stdout.split('\n').length} lines)`.slice(0, 200),
          duration: Date.now() - start,
        });
      });
    });
  }

  private async checkFileExists(filename: string): Promise<CheckResult> {
    try {
      await access(join(this.projectRoot, filename));
      return { name: `File: ${filename}`, passed: true };
    } catch {
      return { name: `File: ${filename}`, passed: false, output: 'Not found' };
    }
  }

  // ── Anti-Scope Check ───────────────────────────────────

  checkAntiScope(
    agentResult: AgentResult,
    memory: MemorySnapshot
  ): AntiScopeViolation[] {
    const violations: AntiScopeViolation[] = [];
    const antiScope = BriefCollector.parseAntiScope(memory.files.mission);

    for (const protectedFile of antiScope.protectedFiles) {
      const touched = agentResult.artifacts.some(a => 
        a === protectedFile || a.endsWith(`/${protectedFile}`)
      );
      if (touched) {
        violations.push({
          type: 'protected-file',
          detail: t().protectedFileViolation(protectedFile),
          file: protectedFile,
        });
      }
    }

    for (const dep of antiScope.forbiddenDeps) {
      const inOutput = agentResult.output.toLowerCase().includes(dep.toLowerCase());
      const inArtifacts = agentResult.artifacts.some(a => 
        a.toLowerCase().includes(dep.toLowerCase())
      );
      if (inOutput || inArtifacts) {
        violations.push({
          type: 'forbidden-dep',
          detail: t().forbiddenDepViolation(dep),
        });
      }
    }

    for (const bc of antiScope.breakingChanges) {
      if (agentResult.output.toLowerCase().includes(bc.toLowerCase())) {
        violations.push({
          type: 'breaking-change',
          detail: t().breakingChangeViolation(bc),
        });
      }
    }

    return violations;
  }

  // ── Mandatory Test Check ───────────────────────────────

  private checkMandatoryTests(agentResult: AgentResult): AntiScopeViolation | null {
    // Only enforce for code tasks that produce source files
    const sourceFiles = agentResult.artifacts.filter(a =>
      a.match(/\.(ts|tsx|js|jsx)$/) &&
      !a.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/) &&
      !a.includes('node_modules') &&
      !a.includes('.d.ts')
    );

    if (sourceFiles.length === 0) return null; // no source files = not a code task

    const testFiles = agentResult.artifacts.filter(a =>
      a.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/)
    );

    if (testFiles.length === 0) {
      return {
        type: 'breaking-change',
        detail: `Code task produced ${sourceFiles.length} source file(s) but no test files. Every code task must include tests.`,
      };
    }

    return null;
  }

  // ── Score Computation ──────────────────────────────────

  private computeScores(
    checks: CheckResult[],
    violations: AntiScopeViolation[],
    agentResult: AgentResult
  ): { consistency: number; quality: number; mission: number } {
    const requiredChecks = checks.filter(c => c.command);
    const passedRequired = requiredChecks.filter(c => c.passed).length;
    const totalRequired = requiredChecks.length || 1;
    const quality = passedRequired / totalRequired;

    const violationPenalty = violations.length * 0.3;
    const mission = Math.max(0, agentResult.success ? 1.0 - violationPenalty : 0.2);

    const memoryChecks = checks.filter(c => c.name.startsWith('File:'));
    const memoryOk = memoryChecks.filter(c => c.passed).length;
    const consistency = memoryChecks.length > 0 ? memoryOk / memoryChecks.length : 0.5;

    return { consistency, quality, mission };
  }

  // ── Issue Building ─────────────────────────────────────

  private buildIssues(
    checks: CheckResult[],
    violations: AntiScopeViolation[]
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const check of checks.filter(c => !c.passed)) {
      issues.push({
        severity: check.command ? 'warning' : 'info',
        category: 'architecture-violation',
        description: `Check failed: ${check.name}${check.output ? ' — ' + check.output.slice(0, 100) : ''}`,
        reference: check.command,
      });
    }

    for (const v of violations) {
      issues.push({
        severity: 'critical',
        category: v.type === 'protected-file' ? 'scope-creep' : 
                  v.type === 'forbidden-dep' ? 'decision-conflict' : 'mission-drift',
        description: v.detail,
        reference: v.file,
      });
    }

    return issues;
  }

  private buildFeedback(
    checks: CheckResult[],
    violations: AntiScopeViolation[],
    llmFeedback?: string
  ): string {
    const parts: string[] = [];
    const passed = checks.filter(c => c.passed).length;
    parts.push(t().checksResult(passed, checks.length));

    if (violations.length > 0) {
      parts.push(t().antiScopeViolation(violations.map(v => v.detail).join('; ')));
    }

    const failed = checks.filter(c => !c.passed && c.command);
    if (failed.length > 0) {
      parts.push(`Failed: ${failed.map(c => c.name).join(', ')}`);
    }

    if (llmFeedback) {
      parts.push(`LLM: ${llmFeedback}`);
    }

    return parts.join('\n');
  }

  // ── LLM Evaluation (optional) ──────────────────────────

  private async llmEvaluate(
    agentResult: AgentResult,
    memory: MemorySnapshot
  ): Promise<{ feedback?: string; issues: ConsistencyIssue[] }> {
    if (!this.provider) return { issues: [] };

    const response = await this.provider.chat(
      [{
        role: 'user',
        content: `Task: ${agentResult.taskId}\nSuccess: ${agentResult.success}\nOutput: ${agentResult.output.slice(0, 2000)}\nMISSION: ${memory.files.mission.slice(0, 1000)}\n\nBriefly evaluate (2-3 sentences).`,
      }],
      {
        system: t().evaluatorSystemPrompt,
        maxTokens: 1024,
      }
    );

    return { feedback: response.text.slice(0, 500), issues: [] };
  }

  // ── Threshold Application ──────────────────────────────

  private applyThresholds(result: RealEvaluationResult): RealEvaluationResult {
    const minScore = Math.min(
      result.consistencyScore,
      result.qualityScore,
      result.missionAlignment
    );

    const hasCritical = result.issues.some(i => i.severity === 'critical');
    const hasAntiScopeViolation = result.antiScopeViolations.length > 0;

    if (hasCritical || hasAntiScopeViolation || minScore < this.escalationThreshold) {
      result.verdict = 'escalate';
    } else if (minScore < 0.7 || result.issues.some(i => i.severity === 'warning')) {
      result.verdict = 'revise';
    } else {
      result.verdict = 'accept';
    }

    return result;
  }
}
