/**
 * Audit Gate — Post-Build Automated Audit
 *
 * Orchestrator plan yürütmeyi bitirdikten sonra:
 * 1. ReverseEngineer ile full audit çalıştır
 * 2. Sorunları WiringIssue olarak raporla
 * 3. Critical sorunları DECISIONS.md'ye kaydet
 * 4. Fix gerekiyorsa TaskDefinition[] döndür (orchestrator tekrar yürütebilir)
 *
 * Build → Audit → Fix döngüsünün "audit" bacağı.
 */

import { StaticAnalyzer } from '../agent/tracer/static-analyzer.js';
import { ReverseEngineer } from '../agent/tracer/reverse-engineer.js';
import type { AuditReport } from '../agent/tracer/reverse-engineer.js';
import type { LLMProvider } from '../llm/types.js';
import type { TaskDefinition, MemoryFiles } from '../types/index.js';

export interface AuditGateResult {
  passed: boolean;
  report: AuditReport;
  fixTasks: TaskDefinition[];
  summary: string;
}

export class AuditGate {
  private projectRoot: string;
  private provider: LLMProvider | null;
  private log: (msg: string) => void;

  constructor(projectRoot: string, provider?: LLMProvider | null, log?: (msg: string) => void) {
    this.projectRoot = projectRoot;
    this.provider = provider ?? null;
    this.log = log ?? console.log;
  }

  /**
   * Full audit gate — pass/fail decision + fix tasks if failed.
   * @param memoryFiles Current memory snapshot (for decision cross-check)
   * @param threshold Minimum health score to pass (default: 70)
   */
  async run(memoryFiles?: Partial<MemoryFiles>, threshold = 70): Promise<AuditGateResult> {
    this.log('  🔍 Audit gate starting...');

    // 1. Build static graph
    const analyzer = new StaticAnalyzer(this.projectRoot);
    const { imports, exports, edges } = await analyzer.buildGraph();

    // 2. Run full audit
    const auditor = new ReverseEngineer(this.projectRoot, this.provider);
    const report = await auditor.audit(imports, exports, edges, {
      mission: memoryFiles?.mission,
      architecture: memoryFiles?.architecture,
      decisions: memoryFiles?.decisions,
    });

    // 3. Log findings
    this.log(`  🏗️  ${report.classifications.length} files classified`);
    this.log(`  🔀 ${report.dataFlows.length} data flows (${report.summary.completeFlows} complete, ${report.summary.incompleteFlows} incomplete)`);
    this.log(`  ⚠️  ${report.violations.length} violations`);
    this.log(`  📜 ${report.summary.decisionsImplemented}/${report.summary.decisionsTotal} decisions implemented`);
    this.log(`  💯 Health: ${report.summary.healthScore}/100 (threshold: ${threshold})`);

    // 4. Generate fix tasks for violations
    const fixTasks = this.generateFixTasks(report);

    // 5. Pass/fail
    const passed = report.summary.healthScore >= threshold;

    if (passed) {
      this.log('  ✅ Audit gate PASSED');
    } else {
      this.log(`  ❌ Audit gate FAILED (${report.summary.healthScore} < ${threshold})`);
      this.log(`  🔧 ${fixTasks.length} fix tasks generated`);
    }

    const summary = this.buildSummary(report, passed, threshold);

    return { passed, report, fixTasks, summary };
  }

  /**
   * Convert audit violations into actionable fix tasks.
   * Orchestrator can feed these back into executePlan().
   */
  private generateFixTasks(report: AuditReport): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];
    let taskCounter = 900; // T9xx namespace for audit-generated tasks

    // Layer skip violations → add service layer
    const layerSkips = report.violations.filter(v => v.type === 'layer-skip');
    if (layerSkips.length > 0) {
      tasks.push({
        id: `T${++taskCounter}`,
        title: 'Add missing service layer',
        description: `Audit found ${layerSkips.length} routes that skip the service layer and access repositories directly.\n\nViolations:\n${layerSkips.map(v => `- ${v.description}`).join('\n')}\n\nExpected: Controller → Service → Repository pattern.\nCreate service classes and route through them.`,
        type: 'code',
        dependencies: [],
        priority: 'high',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: [
          'All routes go through a service layer',
          'No direct repository imports in route/controller files',
          'Existing tests still pass',
        ],
      });
    }

    // Wrong-direction violations → fix dependency direction
    const wrongDir = report.violations.filter(v => v.type === 'wrong-direction');
    if (wrongDir.length > 0) {
      tasks.push({
        id: `T${++taskCounter}`,
        title: 'Fix upward dependency violations',
        description: `Audit found ${wrongDir.length} upward dependencies (lower layer importing higher layer).\n\nViolations:\n${wrongDir.map(v => `- ${v.description}`).join('\n')}\n\nExpected: Dependencies flow downward only.\nExtract shared interfaces or move logic to correct layer.`,
        type: 'code',
        dependencies: [],
        priority: 'high',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: [
          'No lower-layer file imports from upper layers',
          'Shared types extracted to types/ directory',
          'Existing tests still pass',
        ],
      });
    }

    // Decision contradictions → fix code to match decisions
    const contradictions = report.decisionAudit.filter(d => d.status === 'contradicted');
    for (const d of contradictions) {
      tasks.push({
        id: `T${++taskCounter}`,
        title: `Fix contradicted decision: ${d.title}`,
        description: `Audit found that decision "${d.decisionId}: ${d.title}" is contradicted by actual code.\n\nEvidence:\n${d.evidence.filter(e => e.startsWith('⚠️')).map(e => `- ${e}`).join('\n')}\n\nEither fix the code to match the decision, or update DECISIONS.md if the decision changed.`,
        type: 'code',
        dependencies: [],
        priority: 'critical',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: [
          `Code aligns with decision: ${d.title}`,
          'No contradicting imports/patterns remain',
          'DECISIONS.md is up to date',
        ],
      });
    }

    // Incomplete data flows → complete the chain
    const incompleteFlows = report.dataFlows.filter(f => !f.complete);
    if (incompleteFlows.length > 0) {
      tasks.push({
        id: `T${++taskCounter}`,
        title: 'Complete broken data flow chains',
        description: `Audit found ${incompleteFlows.length} incomplete data flow chains.\n\nIncomplete flows:\n${incompleteFlows.map(f => `- ${f.trigger}: ${f.gaps.join('; ')}`).join('\n')}\n\nEnsure each route has a complete chain: route → middleware → service → repository → response.`,
        type: 'code',
        dependencies: [],
        priority: 'medium',
        estimatedComplexity: 'moderate',
        acceptanceCriteria: [
          'All routes have complete handler chains',
          'No inline business logic in route handlers',
          'Services delegate to repositories where applicable',
        ],
      });
    }

    // Pattern inconsistency → standardize
    const patternIssues = report.violations.filter(v => v.type === 'pattern-inconsistency');
    if (patternIssues.length > 0) {
      tasks.push({
        id: `T${++taskCounter}`,
        title: 'Standardize architectural patterns',
        description: `Audit found inconsistent patterns across the codebase.\n\n${patternIssues.map(v => `- ${v.description}`).join('\n')}\n\nPick one pattern and apply it consistently across all routes/modules.`,
        type: 'code',
        dependencies: [],
        priority: 'medium',
        estimatedComplexity: 'simple',
        acceptanceCriteria: [
          'All routes follow the same layered pattern',
          'No mixed direct/service patterns',
        ],
      });
    }

    return tasks;
  }

  private buildSummary(report: AuditReport, passed: boolean, threshold: number): string {
    const parts = [
      `Audit ${passed ? 'PASSED' : 'FAILED'} (${report.summary.healthScore}/${threshold})`,
      `Files: ${report.summary.totalFiles}`,
      `Data flows: ${report.summary.completeFlows}/${report.summary.totalFlows} complete`,
      `Violations: ${report.summary.violationCount}`,
      `Decisions: ${report.summary.decisionsImplemented}/${report.summary.decisionsTotal} implemented`,
    ];

    const contradicted = report.decisionAudit.filter(d => d.status === 'contradicted');
    if (contradicted.length > 0) {
      parts.push(`⚠️ CONTRADICTED: ${contradicted.map(d => d.title).join(', ')}`);
    }

    return parts.join('\n');
  }
}
