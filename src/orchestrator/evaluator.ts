/**
 * Orchestrator — Evaluator (v2)
 * 
 * İki katmanlı değerlendirme:
 * 1. Gerçek kontroller: stack'e göre tsc/npm test/pytest/go build çalıştır
 * 2. Anti-scope kontrolü: MISSION.md'deki yasakları denetle
 * 3. LLM değerlendirmesi: tutarlılık, kalite, misyon uyumu (opsiyonel)
 * 
 * D001: Dosya tabanlı hafıza — MISSION.md'den anti-scope okunur
 * D002: TypeScript stack — tsc/vitest varsayılan kontroller
 */

import { exec } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
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
  'other': [
    // Genel: sadece dosya varlık kontrolü
  ],
};

const EVALUATOR_SYSTEM_PROMPT = `Sen bir kalite ve tutarlılık denetçisisin.
Görevin: Bir agent'ın çıktısını projenin hafızasına karşı değerlendirmek.

Skorlar (0-1): consistencyScore, qualityScore, missionAlignment
Sorun kategorileri: mission-drift, architecture-violation, decision-conflict, scope-creep

Karar: accept (>0.7), revise (0.4-0.7), escalate (<0.4 veya critical)
Çıktı: JSON (EvaluationResult)`;

export class Evaluator {
  private client: Anthropic | null;
  private model: string;
  private escalationThreshold: number;
  private projectRoot: string;

  constructor(config: OrchestratorConfig) {
    // API key yoksa LLM evaluation'ı atla, sadece gerçek kontrolleri çalıştır
    this.client = config.claudeApiKey 
      ? new Anthropic({ apiKey: config.claudeApiKey })
      : null;
    this.model = config.model;
    this.escalationThreshold = config.escalationThreshold;
    this.projectRoot = config.projectRoot;
  }

  /**
   * Tam değerlendirme: gerçek kontroller + anti-scope + LLM
   */
  async evaluate(
    agentResult: AgentResult,
    memory: MemorySnapshot
  ): Promise<RealEvaluationResult> {
    // 1. Stack tespiti
    const stackDetected = await this.detectStack(memory);

    // 2. Gerçek kontrolleri çalıştır
    const checks = await this.runStackChecks(stackDetected);

    // 3. Anti-scope kontrolü
    const antiScopeViolations = this.checkAntiScope(agentResult, memory);

    // 4. Skorları hesapla
    const scores = this.computeScores(checks, antiScopeViolations, agentResult);

    // 5. Issues oluştur
    const issues = this.buildIssues(checks, antiScopeViolations);

    // 6. LLM değerlendirmesi (opsiyonel — API key yoksa atla)
    let llmFeedback: string | undefined;
    if (this.client) {
      try {
        const llmResult = await this.llmEvaluate(agentResult, memory);
        llmFeedback = llmResult.feedback;
        // LLM issues'ları da ekle
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
    // 1. MISSION.md'den explicit stack bilgisi
    const missionStack = BriefCollector.parseStackType(memory.files.mission);
    if (missionStack) return missionStack;

    // 2. Dosya tabanlı otomatik tespit
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
        // package.json varsa React mı kontrol et
        if (file === 'package.json' && stack === 'typescript-node') {
          try {
            const pkg = await readFile(join(this.projectRoot, 'package.json'), 'utf-8');
            if (pkg.includes('"react"')) return 'react';
          } catch { /* ignore */ }
        }
        return stack;
      } catch { /* dosya yok, devam */ }
    }

    return 'other';
  }

  // ── Real Stack Checks ──────────────────────────────────

  async runStackChecks(stack: StackType): Promise<CheckResult[]> {
    const checks = STACK_CHECKS[stack] ?? [];
    const results: CheckResult[] = [];

    for (const check of checks) {
      const result = await this.runCommand(check.name, check.command);
      results.push(result);
    }

    // Genel kontroller — her stack için
    results.push(await this.checkFileExists('MISSION.md'));
    results.push(await this.checkFileExists('ARCHITECTURE.md'));
    results.push(await this.checkFileExists('DECISIONS.md'));
    results.push(await this.checkFileExists('STATE.md'));

    return results;
  }

  private runCommand(name: string, command: string): Promise<CheckResult> {
    const start = Date.now();
    return new Promise((resolve) => {
      exec(command, { cwd: this.projectRoot, timeout: 30_000 }, (error, stdout, stderr) => {
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

    // 1. Protected files — agent bu dosyalara dokunmuş mu?
    for (const protectedFile of antiScope.protectedFiles) {
      const touched = agentResult.artifacts.some(a => 
        a === protectedFile || a.endsWith(`/${protectedFile}`)
      );
      if (touched) {
        violations.push({
          type: 'protected-file',
          detail: `Agent yasaklı dosyaya dokundu: ${protectedFile}`,
          file: protectedFile,
        });
      }
    }

    // 2. Forbidden deps — agent çıktısında yasaklı import var mı?
    for (const dep of antiScope.forbiddenDeps) {
      const inOutput = agentResult.output.toLowerCase().includes(dep.toLowerCase());
      const inArtifacts = agentResult.artifacts.some(a => 
        a.toLowerCase().includes(dep.toLowerCase())
      );
      if (inOutput || inArtifacts) {
        violations.push({
          type: 'forbidden-dep',
          detail: `Yasaklı bağımlılık tespit edildi: ${dep}`,
        });
      }
    }

    // 3. Breaking changes — keyword scan
    for (const bc of antiScope.breakingChanges) {
      if (agentResult.output.toLowerCase().includes(bc.toLowerCase())) {
        violations.push({
          type: 'breaking-change',
          detail: `Kabul edilemez kırılma tespit edildi: ${bc}`,
        });
      }
    }

    return violations;
  }

  // ── Score Computation ──────────────────────────────────

  private computeScores(
    checks: CheckResult[],
    violations: AntiScopeViolation[],
    agentResult: AgentResult
  ): { consistency: number; quality: number; mission: number } {
    // Quality: gerçek kontrollerden
    const requiredChecks = checks.filter(c => c.command); // komut çalıştırılan kontroller
    const passedRequired = requiredChecks.filter(c => c.passed).length;
    const totalRequired = requiredChecks.length || 1;
    const quality = passedRequired / totalRequired;

    // Mission alignment: anti-scope ihlalleri düşürür
    const violationPenalty = violations.length * 0.3;
    const mission = Math.max(0, agentResult.success ? 1.0 - violationPenalty : 0.2);

    // Consistency: hafıza dosyaları mevcut mu
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

    // Başarısız kontroller
    for (const check of checks.filter(c => !c.passed)) {
      issues.push({
        severity: check.command ? 'warning' : 'info',
        category: 'architecture-violation',
        description: `Check failed: ${check.name}${check.output ? ' — ' + check.output.slice(0, 100) : ''}`,
        reference: check.command,
      });
    }

    // Anti-scope ihlalleri (hep critical)
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
    parts.push(`Checks: ${passed}/${checks.length} passed`);

    if (violations.length > 0) {
      parts.push(`⚠️ Anti-scope violations: ${violations.map(v => v.detail).join('; ')}`);
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
    if (!this.client) return { issues: [] };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: EVALUATOR_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Task: ${agentResult.taskId}\nSuccess: ${agentResult.success}\nOutput: ${agentResult.output.slice(0, 2000)}\nMISSION: ${memory.files.mission.slice(0, 1000)}\n\nKısa değerlendir (2-3 cümle).`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text).join('');

    return { feedback: text.slice(0, 500), issues: [] };
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
