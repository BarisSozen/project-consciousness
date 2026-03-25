/**
 * Surgical Corrector — Post-Audit Mission-Aligned Correction Advisor
 *
 * Audit bulguları → MISSION.md/ARCHITECTURE.md/DECISIONS.md filtreleri →
 * OPERATE / TREAT / MONITOR / ACKNOWLEDGE sınıflandırması.
 *
 * Hibrit model: basit vakalar deterministik, ambiguous vakalar LLM'e sorulur.
 */

import type { LLMProvider } from '../../llm/types.js';
import type {
  TypeFlowReport,
  ComplexityReport,
  CoverageIntelReport,
  RiskZone,
  FunctionComplexity,
  TypeFlowNode,
} from '../../types/index.js';
import type {
  AuditReport,
  ArchitectureViolation,
  DecisionAuditResult,
} from './reverse-engineer.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type CorrectionLevel = 'OPERATE' | 'TREAT' | 'MONITOR' | 'ACKNOWLEDGE';

export interface Correction {
  level: CorrectionLevel;
  title: string;
  description: string;
  file?: string;
  line?: number;
  /** Why this level was chosen */
  reasoning: string;
  /** What to do (OPERATE/TREAT) or what to watch (MONITOR) */
  prescription: string;
  /** Corrections that must happen before this one */
  blockedBy: string[];
  /** Which mission criterion or decision this protects */
  validates?: string;
  /** Estimated effort: S = <30min, M = <2h, L = >2h */
  effort: 'S' | 'M' | 'L';
  /** Source: which analyzer produced this finding */
  source: 'audit' | 'type-flow' | 'complexity' | 'coverage' | 'security' | 'llm-triage';
}

export interface ProjectSoul {
  purpose: string;
  identity: string;
  boundaries: string[];
  principles: string[];
  phase: string;
  lockedDecisions: string[];
  successCriteria: string[];
}

export interface CorrectionPlan {
  soul: ProjectSoul;
  corrections: Correction[];
  summary: {
    operate: number;
    treat: number;
    monitor: number;
    acknowledge: number;
    total: number;
  };
  healthBefore: number;
  healthProjected: number;
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════
// Memory File Parsing
// ═══════════════════════════════════════════════════════════

function extractSuccessCriteria(mission?: string): string[] {
  if (!mission) return [];
  const criteria: string[] = [];
  const lines = mission.split('\n');
  let inCriteria = false;

  for (const line of lines) {
    if (/^#+\s*(SUCCESS CRITERIA|Başarı Tanımı|Başarı Kriterleri)/i.test(line)) {
      inCriteria = true;
      continue;
    }
    if (inCriteria && /^#+\s/.test(line)) break;
    if (inCriteria) {
      const match = line.match(/^\s*[-*\d.]+\s+(.+)/);
      if (match?.[1]) criteria.push(match[1].trim());
    }
  }
  return criteria;
}

function extractAntiScope(mission?: string): string[] {
  if (!mission) return [];
  const items: string[] = [];
  const lines = mission.split('\n');
  let inAntiScope = false;

  for (const line of lines) {
    if (/^#+\s*(ANTI-SCOPE|Kapsam Dışı|Anti.?Scope)/i.test(line)) {
      inAntiScope = true;
      continue;
    }
    if (inAntiScope && /^#+\s/.test(line)) break;
    if (inAntiScope) {
      const match = line.match(/^\s*[-*]\s+(.+)/);
      if (match?.[1]) items.push(match[1].trim());
    }
  }
  return items;
}

function extractLockedDecisions(decisions?: string): string[] {
  if (!decisions) return [];
  const locked: string[] = [];
  const matches = decisions.matchAll(/^#+\s*(D\d+)[:\s]+(.+)/gm);
  for (const m of matches) {
    if (m[1] && m[2]) locked.push(`${m[1]}: ${m[2].trim()}`);
  }
  return locked;
}

function extractProjectPhase(state?: string): string {
  if (!state) return 'unknown';
  const match = state.match(/phase[:\s]*`?(\w+)`?/i);
  return match?.[1] ?? 'unknown';
}

function buildProjectSoul(
  mission?: string,
  _architecture?: string,
  decisions?: string,
  state?: string,
): ProjectSoul {
  const purposeMatch = mission?.match(/##\s*(Neden Varız|Ne İnşa Ediyoruz|What|Purpose)[\s\S]*?\n\n([\s\S]*?)\n\n/i);
  const identityMatch = mission?.match(/##\s*SCOPE[\s\S]*?\*\*Ne inşa ediyoruz\*\*:\s*(.+)/i);

  return {
    purpose: purposeMatch?.[2]?.trim()?.split('\n')[0] ?? 'Unknown',
    identity: identityMatch?.[1]?.trim() ?? 'Unknown project type',
    boundaries: extractAntiScope(mission),
    principles: [], // Extracted from ARCHITECTURE.md if present
    phase: extractProjectPhase(state),
    lockedDecisions: extractLockedDecisions(decisions),
    successCriteria: extractSuccessCriteria(mission),
  };
}

// ═══════════════════════════════════════════════════════════
// Deterministic Classification Rules
// ═══════════════════════════════════════════════════════════

function classifyViolation(
  v: ArchitectureViolation,
  _soul: ProjectSoul,
): Correction | null {
  // Acknowledged = ACKNOWLEDGE (always)
  if (v.acknowledged) {
    return {
      level: 'ACKNOWLEDGE',
      title: `[${v.type}] ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: `Acknowledged: ${v.acknowledgeReason ?? 'matches project convention'}`,
      prescription: 'No action needed — intentional design trade-off.',
      blockedBy: [],
      effort: 'S',
      source: 'audit',
    };
  }

  // Security-related violations → always OPERATE
  if (v.description.toLowerCase().match(/secur|inject|xss|csrf|auth|secret|credential/)) {
    return {
      level: 'OPERATE',
      title: `[SECURITY] ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: 'Security findings always require immediate action.',
      prescription: v.expectedBehavior,
      blockedBy: [],
      effort: 'M',
      source: 'security',
    };
  }

  // Decision contradictions → OPERATE
  if (v.type === 'decision-contradicted') {
    return {
      level: 'OPERATE',
      title: `Decision contradiction: ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: 'Contradicting an active decision erodes the decision system credibility.',
      prescription: v.expectedBehavior,
      blockedBy: [],
      validates: 'Decision system integrity',
      effort: 'M',
      source: 'audit',
    };
  }

  // Coupling violations → severity-based
  if (v.type === 'coupling-violation') {
    return {
      level: v.severity === 'critical' ? 'OPERATE' : 'TREAT',
      title: `Coupling: ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: v.severity === 'critical'
        ? 'Critical coupling creates compounding damage as codebase grows.'
        : 'Coupling weakens module boundaries but isn\'t causing active damage.',
      prescription: v.expectedBehavior,
      blockedBy: [],
      effort: v.severity === 'critical' ? 'M' : 'S',
      source: 'audit',
    };
  }

  // Layer-skip, wrong-direction → TREAT by default
  if (v.type === 'layer-skip' || v.type === 'wrong-direction') {
    return {
      level: v.severity === 'critical' ? 'OPERATE' : 'TREAT',
      title: `[${v.type}] ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: v.severity === 'critical'
        ? 'Critical architecture violation — weakens structural integrity.'
        : 'Architecture deviation — should be fixed but not urgent.',
      prescription: v.expectedBehavior,
      blockedBy: [],
      effort: 'S',
      source: 'audit',
    };
  }

  // Pattern inconsistency → TREAT
  if (v.type === 'pattern-inconsistency') {
    return {
      level: 'TREAT',
      title: `Pattern inconsistency: ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: 'Inconsistent patterns increase cognitive load for maintainers.',
      prescription: v.expectedBehavior,
      blockedBy: [],
      effort: 'S',
      source: 'audit',
    };
  }

  // Decision missing → MONITOR
  if (v.type === 'decision-missing') {
    return {
      level: 'MONITOR',
      title: `Missing decision: ${v.description}`,
      description: v.evidence,
      file: v.file,
      reasoning: 'Not yet a problem, but should be documented if pattern solidifies.',
      prescription: `Consider adding a decision to DECISIONS.md: "${v.expectedBehavior}"`,
      blockedBy: [],
      effort: 'S',
      source: 'audit',
    };
  }

  // Fallback
  return {
    level: v.severity === 'critical' ? 'OPERATE' : v.severity === 'warning' ? 'TREAT' : 'MONITOR',
    title: v.description,
    description: v.evidence,
    file: v.file,
    reasoning: `Classified by severity: ${v.severity}`,
    prescription: v.expectedBehavior,
    blockedBy: [],
    effort: 'S',
    source: 'audit',
  };
}

function classifyDecisionAudit(d: DecisionAuditResult): Correction | null {
  if (d.status === 'implemented') return null; // No correction needed

  if (d.status === 'contradicted') {
    return {
      level: 'OPERATE',
      title: `Decision ${d.decisionId} contradicted: ${d.title}`,
      description: `Evidence: ${d.evidence.join('; ')}`,
      file: d.files[0],
      reasoning: 'Active decision is directly violated in code.',
      prescription: `Align code with ${d.decisionId}, or update ${d.decisionId} if the decision is outdated.`,
      blockedBy: [],
      validates: d.decisionId,
      effort: 'M',
      source: 'audit',
    };
  }

  if (d.status === 'partially-implemented') {
    return {
      level: 'TREAT',
      title: `Decision ${d.decisionId} incomplete: ${d.title}`,
      description: `Implemented in: ${d.files.join(', ')}. Evidence: ${d.evidence.join('; ')}`,
      file: d.files[0],
      reasoning: 'Decision is partially followed — gaps should be closed.',
      prescription: `Complete implementation of ${d.decisionId} across all relevant files.`,
      blockedBy: [],
      validates: d.decisionId,
      effort: 'M',
      source: 'audit',
    };
  }

  // not-found
  return {
    level: 'MONITOR',
    title: `Decision ${d.decisionId} not found in code: ${d.title}`,
    description: 'No evidence of implementation found.',
    reasoning: 'Decision exists but has no implementation. May be planned for later.',
    prescription: `Verify if ${d.decisionId} is still relevant. If yes, implement. If not, mark as superseded.`,
    blockedBy: [],
    validates: d.decisionId,
    effort: 'S',
    source: 'audit',
  };
}

function classifyHotType(t: TypeFlowNode, coverageFiles: Set<string>): Correction | null {
  const hasTests = coverageFiles.has(t.file);
  if (t.usageCount < 10 && hasTests) return null; // Low risk, covered

  if (t.usageCount >= 15 && !hasTests) {
    return {
      level: 'OPERATE',
      title: `Hot type "${t.name}" (${t.usageCount} files) has no test coverage`,
      description: `Defined in ${t.file}:${t.line}. Used by: ${t.usedBy.slice(0, 5).join(', ')}${t.usedBy.length > 5 ? '...' : ''}`,
      file: t.file,
      line: t.line,
      reasoning: 'High blast radius type with zero test coverage — any change breaks silently.',
      prescription: `Add type-level tests for ${t.name}. At minimum, verify all fields are used correctly in top consumers.`,
      blockedBy: [],
      effort: 'M',
      source: 'type-flow',
    };
  }

  if (t.usageCount >= 15) {
    return {
      level: 'MONITOR',
      title: `Hot type "${t.name}" — ${t.usageCount} file blast radius`,
      description: `Defined in ${t.file}:${t.line}`,
      file: t.file,
      line: t.line,
      reasoning: 'High usage but covered — monitor for growth.',
      prescription: `Watch for usage count crossing 25 files. Consider splitting if responsibilities diverge.`,
      blockedBy: [],
      effort: 'S',
      source: 'type-flow',
    };
  }

  if (!hasTests) {
    return {
      level: 'TREAT',
      title: `Type "${t.name}" (${t.usageCount} files) lacks test coverage`,
      description: `Defined in ${t.file}:${t.line}`,
      file: t.file,
      line: t.line,
      reasoning: 'Moderate blast radius without safety net.',
      prescription: `Add tests covering ${t.name}'s core usage patterns.`,
      blockedBy: [],
      effort: 'S',
      source: 'type-flow',
    };
  }

  return null;
}

function classifyComplexity(fn: FunctionComplexity): Correction | null {
  if (fn.rating === 'ok') return null;

  if (fn.rating === 'critical') {
    return {
      level: 'TREAT',
      title: `Complexity hotspot: ${fn.name} (cc:${fn.cyclomatic} cog:${fn.cognitive})`,
      description: `${fn.file}:${fn.line}`,
      file: fn.file,
      line: fn.line,
      reasoning: 'Critical complexity — high bug probability and hard to maintain.',
      prescription: `Extract sub-functions or simplify conditionals. Target: cyclomatic < 10, cognitive < 15.`,
      blockedBy: [],
      effort: 'M',
      source: 'complexity',
    };
  }

  // warning
  return {
    level: 'MONITOR',
    title: `Growing complexity: ${fn.name} (cc:${fn.cyclomatic} cog:${fn.cognitive})`,
    description: `${fn.file}:${fn.line}`,
    file: fn.file,
    line: fn.line,
    reasoning: 'Approaching complexity threshold — not yet critical.',
    prescription: `Watch for additional conditionals. Escalate to TREAT if function grows.`,
    blockedBy: [],
    effort: 'S',
    source: 'complexity',
  };
}

function classifyRiskZone(r: RiskZone): Correction {
  return {
    level: r.riskScore >= 80 ? 'OPERATE' : 'TREAT',
    title: `Risk zone: ${r.functionName} (risk:${r.riskScore})`,
    description: `${r.file}:${r.line} — ${r.reason}`,
    file: r.file,
    line: r.line,
    reasoning: r.riskScore >= 80
      ? 'High complexity + low coverage = silent failure zone.'
      : 'Moderate risk — should be addressed before next release.',
    prescription: `Add test coverage for ${r.functionName}, then simplify if possible.`,
    blockedBy: [],
    effort: 'M',
    source: 'coverage',
  };
}

// ═══════════════════════════════════════════════════════════
// LLM Triage — for ambiguous cases
// ═══════════════════════════════════════════════════════════

interface AmbiguousCase {
  finding: string;
  context: string;
  currentClassification: CorrectionLevel;
}

async function llmTriage(
  provider: LLMProvider,
  soul: ProjectSoul,
  ambiguousCases: AmbiguousCase[],
): Promise<Map<number, CorrectionLevel>> {
  if (ambiguousCases.length === 0) return new Map();

  const casesText = ambiguousCases.map((c, i) =>
    `Case ${i + 1}:\n  Finding: ${c.finding}\n  Context: ${c.context}\n  Current: ${c.currentClassification}`
  ).join('\n\n');

  const response = await provider.chat([
    {
      role: 'user',
      content: `You are a surgical correction advisor. Given this project context:

Purpose: ${soul.purpose}
Identity: ${soul.identity}
Boundaries: ${soul.boundaries.join(', ') || 'none specified'}
Success Criteria: ${soul.successCriteria.join('; ') || 'none specified'}
Phase: ${soul.phase}

Classify each finding as OPERATE (immediate fix), TREAT (planned fix), MONITOR (watch), or ACKNOWLEDGE (intentional, skip).

${casesText}

Respond with ONLY a JSON array of objects: [{"case": 1, "level": "OPERATE", "reason": "..."}]
No markdown, no explanation outside the JSON.`,
    },
  ], { temperature: 0.1, maxTokens: 1024 });

  const results = new Map<number, CorrectionLevel>();
  try {
    const parsed = JSON.parse(response.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    for (const item of parsed) {
      const level = item.level?.toUpperCase();
      if (['OPERATE', 'TREAT', 'MONITOR', 'ACKNOWLEDGE'].includes(level)) {
        results.set(item.case - 1, level as CorrectionLevel);
      }
    }
  } catch {
    // LLM response unparseable — keep deterministic classifications
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// Main Corrector
// ═══════════════════════════════════════════════════════════

export interface SurgicalCorrectorInput {
  /** Standard audit report (from /audit) */
  auditReport?: AuditReport;
  /** Deep audit components (from /deep-audit) */
  typeFlow?: TypeFlowReport;
  complexity?: ComplexityReport;
  coverage?: CoverageIntelReport;
  /** Memory files */
  mission?: string;
  architecture?: string;
  decisions?: string;
  state?: string;
}

export class SurgicalCorrector {
  private provider: LLMProvider | null;
  private log: (msg: string) => void;

  constructor(provider?: LLMProvider | null, log?: (msg: string) => void) {
    this.provider = provider ?? null;
    this.log = log ?? console.log;
  }

  async analyze(input: SurgicalCorrectorInput): Promise<CorrectionPlan> {
    this.log('  🔪 Surgical correction analysis starting...');

    // Phase 1: Build project soul
    const soul = buildProjectSoul(input.mission, input.architecture, input.decisions, input.state);
    this.log(`  📋 Project: ${soul.identity} (phase: ${soul.phase})`);

    const corrections: Correction[] = [];
    const ambiguous: AmbiguousCase[] = [];

    // Phase 2a: Classify audit violations
    if (input.auditReport) {
      for (const v of input.auditReport.violations) {
        const c = classifyViolation(v, soul);
        if (c) {
          // Mark ambiguous: layer-skip with warning severity in early-phase project
          if (v.type === 'layer-skip' && v.severity === 'warning' && soul.phase === 'executing') {
            ambiguous.push({
              finding: c.title,
              context: `File: ${v.file}. Evidence: ${v.evidence}`,
              currentClassification: c.level,
            });
          }
          corrections.push(c);
        }
      }

      // Phase 2b: Classify decision audit
      for (const d of input.auditReport.decisionAudit) {
        const c = classifyDecisionAudit(d);
        if (c) corrections.push(c);
      }
    }

    // Phase 2c: Classify deep audit findings
    const coveredFiles = new Set<string>();
    if (input.coverage) {
      for (const f of input.coverage.files) {
        if (f.lines.percent > 0) coveredFiles.add(f.file);
      }

      for (const r of input.coverage.riskZones) {
        corrections.push(classifyRiskZone(r));
      }
    }

    if (input.typeFlow) {
      for (const t of input.typeFlow.hotTypes) {
        const c = classifyHotType(t, coveredFiles);
        if (c) corrections.push(c);
      }
    }

    if (input.complexity) {
      for (const fn of input.complexity.hotspots) {
        const c = classifyComplexity(fn);
        if (c) corrections.push(c);
      }
    }

    // Phase 3: LLM triage for ambiguous cases
    if (this.provider && ambiguous.length > 0) {
      this.log(`  🧠 LLM triage for ${ambiguous.length} ambiguous findings...`);
      try {
        const llmResults = await llmTriage(this.provider, soul, ambiguous);
        for (const [idx, newLevel] of llmResults) {
          const finding = ambiguous[idx];
          if (!finding) continue;
          const match = corrections.find(c => c.title === finding.finding);
          if (match && match.level !== newLevel) {
            match.level = newLevel;
            match.reasoning += ` [LLM reclassified from ${finding.currentClassification}]`;
            match.source = 'llm-triage';
          }
        }
      } catch {
        this.log('  ⚠️ LLM triage failed — using deterministic classifications');
      }
    }

    // Phase 4: Sort by priority
    const levelOrder: Record<CorrectionLevel, number> = {
      'OPERATE': 0, 'TREAT': 1, 'MONITOR': 2, 'ACKNOWLEDGE': 3,
    };
    corrections.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

    // Calculate projected health
    const healthBefore = input.auditReport?.summary.healthScore ?? 0;
    const operateCount = corrections.filter(c => c.level === 'OPERATE').length;
    const healthProjected = Math.min(100, healthBefore + operateCount * 5);

    const plan: CorrectionPlan = {
      soul,
      corrections,
      summary: {
        operate: corrections.filter(c => c.level === 'OPERATE').length,
        treat: corrections.filter(c => c.level === 'TREAT').length,
        monitor: corrections.filter(c => c.level === 'MONITOR').length,
        acknowledge: corrections.filter(c => c.level === 'ACKNOWLEDGE').length,
        total: corrections.length,
      },
      healthBefore,
      healthProjected,
      timestamp: new Date().toISOString(),
    };

    this.log(`  ✅ ${plan.summary.total} findings classified: ${plan.summary.operate} OPERATE, ${plan.summary.treat} TREAT, ${plan.summary.monitor} MONITOR, ${plan.summary.acknowledge} ACKNOWLEDGE`);

    return plan;
  }
}

// ═══════════════════════════════════════════════════════════
// Console Printer
// ═══════════════════════════════════════════════════════════

export function printCorrectionPlan(plan: CorrectionPlan): void {
  console.log('\n  ═══════════════════════════════════════════');
  console.log('  🔪 SURGICAL CORRECTION PLAN');
  console.log('  ═══════════════════════════════════════════\n');

  console.log(`  Project: ${plan.soul.identity}`);
  console.log(`  Phase: ${plan.soul.phase}`);
  console.log(`  Health: ${plan.healthBefore}/100 → ${plan.healthProjected}/100 (projected after OPERATE)\n`);

  console.log(`  Summary: 🚨 ${plan.summary.operate} OPERATE  ⚠️ ${plan.summary.treat} TREAT  👀 ${plan.summary.monitor} MONITOR  ✅ ${plan.summary.acknowledge} ACKNOWLEDGE\n`);

  // OPERATE
  const operates = plan.corrections.filter(c => c.level === 'OPERATE');
  if (operates.length > 0) {
    console.log('  ── OPERATE (immediate) ──────────────────');
    for (const [i, c] of operates.entries()) {
      console.log(`\n  ${i + 1}. 🚨 ${c.title}`);
      if (c.file) console.log(`     📁 ${c.file}${c.line ? `:${c.line}` : ''}`);
      console.log(`     💡 ${c.prescription}`);
      console.log(`     📐 Effort: ${c.effort} | Source: ${c.source}`);
      if (c.validates) console.log(`     🎯 Protects: ${c.validates}`);
    }
  }

  // TREAT
  const treats = plan.corrections.filter(c => c.level === 'TREAT');
  if (treats.length > 0) {
    console.log('\n  ── TREAT (planned) ──────────────────────');
    for (const c of treats) {
      console.log(`\n  ⚠️ ${c.title}`);
      if (c.file) console.log(`     📁 ${c.file}${c.line ? `:${c.line}` : ''}`);
      console.log(`     💡 ${c.prescription}`);
      console.log(`     📐 Effort: ${c.effort}`);
    }
  }

  // MONITOR
  const monitors = plan.corrections.filter(c => c.level === 'MONITOR');
  if (monitors.length > 0) {
    console.log('\n  ── MONITOR (watch list) ─────────────────');
    for (const c of monitors) {
      console.log(`  👀 ${c.title}`);
      console.log(`     ↳ ${c.prescription}`);
    }
  }

  // ACKNOWLEDGE
  const acks = plan.corrections.filter(c => c.level === 'ACKNOWLEDGE');
  if (acks.length > 0) {
    console.log('\n  ── ACKNOWLEDGE (no action) ──────────────');
    for (const c of acks) {
      console.log(`  ✅ ${c.title}`);
      console.log(`     ↳ ${c.reasoning}`);
    }
  }

  console.log('\n  ═══════════════════════════════════════════\n');
}
