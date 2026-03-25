/**
 * Plan Generator — LLM-free Project Planning
 *
 * Brief + stack bilgisinden yapılandırılmış proje planı üretir.
 * Keyword detection ile feature'ları tespit eder, stack template'leriyle
 * birleştirip fazlı bir plan oluşturur.
 *
 * Hiçbir LLM çağrısı yapmaz — tamamen heuristik tabanlı.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ProjectPlan,
  ProjectPhase,
  PhaseTask,
  Brief,
} from '../types/index.js';
import {
  STACK_TEMPLATES,
  FEATURE_DETECTORS,
  TESTING_PHASE,
  DOCUMENTATION_PHASE,
} from './templates.js';

export class PlanGenerator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Brief'ten plan üret.
   * 1. Stack template'ini al
   * 2. Keyword detection ile ekstra fazları ekle
   * 3. Success criteria'yı acceptance criteria'ya map et
   * 4. ID'leri ve dependency'leri ata
   */
  async generate(brief: Brief): Promise<ProjectPlan> {
    const { stack, whatToBuild, successCriteria } = brief.scope;
    const briefText = whatToBuild.toLowerCase();

    // 1. Stack base template
    const basePhases = structuredClone(STACK_TEMPLATES[stack] ?? STACK_TEMPLATES['typescript-node']);

    // 2. Feature detection — brief'teki keyword'lerle eşleş
    const detectedFeatures: string[] = [];
    const featurePhases: Array<Omit<ProjectPhase, 'id' | 'dependsOn'>> = [];

    for (const detector of FEATURE_DETECTORS) {
      // Skip frontend for api-only projects
      if (detector.name === 'frontend') {
        const isApiOnly = briefText.includes('api-only') || briefText.includes('api only') ||
          briefText.includes('sadece api') || briefText.includes('backend') ||
          briefText.includes('frontend yok');
        if (isApiOnly) continue;
      }

      if (detector.keywords.some(kw => briefText.includes(kw))) {
        detectedFeatures.push(detector.name);
        featurePhases.push(structuredClone(detector.phase));
      }
    }

    // Reorder: DB before Auth (auth needs user table)
    const dbIdx = featurePhases.findIndex(p => p.name.includes('Database'));
    const authIdx = featurePhases.findIndex(p => p.name.includes('Auth'));
    if (dbIdx > authIdx && authIdx >= 0 && dbIdx >= 0) {
      const [dbPhase] = featurePhases.splice(dbIdx, 1);
      featurePhases.splice(authIdx, 0, dbPhase!);
      // Also reorder detected features
      const dbFeatIdx = detectedFeatures.indexOf('database');
      const authFeatIdx = detectedFeatures.indexOf('auth');
      if (dbFeatIdx > authFeatIdx && authFeatIdx >= 0) {
        detectedFeatures.splice(dbFeatIdx, 1);
        detectedFeatures.splice(authFeatIdx, 0, 'database');
      }
    }

    // 3. Mevcut codebase analizi
    const hasExistingCode = await this.checkExistingCode();

    // 4. Fazları birleştir: setup → core → features → test → docs
    const allRawPhases = [
      ...basePhases,
      ...featurePhases,
      TESTING_PHASE,
      DOCUMENTATION_PHASE,
    ];

    // 5. Mevcut kod varsa setup fazını "Adapt" olarak güncelle
    if (hasExistingCode) {
      const setupPhase = allRawPhases[0];
      if (setupPhase) {
        setupPhase.name = 'Codebase Review & Adaptation';
        setupPhase.description = 'Mevcut kodu analiz et, eksikleri belirle, yeni yapıyla uyumla';
        setupPhase.tasks = [
          { id: '', title: 'Mevcut kod audit (/audit)', type: 'config', targetFiles: [] },
          { id: '', title: 'Eksik yapıları belirle', type: 'config', targetFiles: [] },
          { id: '', title: 'Refactor planı oluştur', type: 'document', targetFiles: [] },
        ];
      }
    }

    // 6. ID'leri ve dependency'leri ata
    const phases: ProjectPhase[] = allRawPhases.map((raw, i) => {
      const phaseId = i + 1;
      const tasks: PhaseTask[] = raw.tasks.map((t, ti) => ({
        ...t,
        id: `P${phaseId}.T${ti + 1}`,
      }));

      return {
        ...raw,
        id: phaseId,
        tasks,
        dependsOn: i === 0 ? [] : [i], // her faz öncekine bağlı (basit linear dep)
      };
    });

    // 7. Success criteria'yı son fazlara dağıt
    if (successCriteria.length > 0) {
      const testPhase = phases.find(p => p.name === 'Testing & QA');
      if (testPhase) {
        testPhase.acceptanceCriteria.push(
          ...successCriteria.map(c => `✓ ${c}`)
        );
      }
    }

    return {
      phases,
      metadata: {
        stack,
        brief: whatToBuild,
        detectedFeatures,
        hasExistingCode,
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Planı PLAN.md olarak yaz
   */
  async writePlan(plan: ProjectPlan): Promise<string> {
    const md = this.renderPlanMd(plan);
    const planPath = join(this.projectRoot, 'PLAN.md');
    await writeFile(planPath, md, 'utf-8');
    return planPath;
  }

  /**
   * Planı konsola yazdır
   */
  printPlan(plan: ProjectPlan): void {
    const { metadata, phases } = plan;

    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║           📋 PROJECT PLAN                    ║');
    console.log('  ╚══════════════════════════════════════════════╝\n');

    console.log(`  📦 Stack: ${metadata.stack}`);
    console.log(`  📝 Brief: ${metadata.brief.slice(0, 80)}${metadata.brief.length > 80 ? '...' : ''}`);
    if (metadata.detectedFeatures.length > 0) {
      console.log(`  🔍 Detected: ${metadata.detectedFeatures.join(', ')}`);
    }
    if (metadata.hasExistingCode) {
      console.log('  📂 Mevcut codebase tespit edildi — plan buna göre ayarlandı');
    }

    console.log('\n  ━━━ Phases ━━━\n');

    for (const phase of phases) {
      const depStr = phase.dependsOn.length > 0
        ? ` (← P${phase.dependsOn.join(', P')})`
        : '';

      console.log(`  ┌─ Phase ${phase.id}: ${phase.name}${depStr}`);
      console.log(`  │  ${phase.description}`);
      console.log('  │');

      for (const task of phase.tasks) {
        const typeIcon = { create: '🆕', modify: '✏️', config: '⚙️', test: '🧪', document: '📄' }[task.type];
        const files = task.targetFiles.length > 0
          ? ` → ${task.targetFiles.join(', ')}`
          : '';
        console.log(`  │  ${typeIcon} ${task.id}: ${task.title}${files}`);
      }

      console.log('  │');
      console.log('  │  Acceptance:');
      for (const ac of phase.acceptanceCriteria) {
        console.log(`  │    ☐ ${ac}`);
      }
      console.log('  └───────────────────────────────────────\n');
    }

    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
    console.log(`  📊 ${phases.length} phases, ${totalTasks} tasks`);
    console.log(`  📄 PLAN.md dosyasına yazılacak\n`);
  }

  // ── Private Helpers ──────────────────────────────────────

  private async checkExistingCode(): Promise<boolean> {
    try {
      const pkg = await readFile(join(this.projectRoot, 'package.json'), 'utf-8');
      return !!pkg;
    } catch {
      // Check for other project files
      try {
        await readFile(join(this.projectRoot, 'pyproject.toml'), 'utf-8');
        return true;
      } catch {
        try {
          await readFile(join(this.projectRoot, 'go.mod'), 'utf-8');
          return true;
        } catch {
          return false;
        }
      }
    }
  }

  private renderPlanMd(plan: ProjectPlan): string {
    const { metadata, phases } = plan;
    const lines: string[] = [];

    lines.push('# PROJECT PLAN');
    lines.push('');
    lines.push(`> Generated: ${metadata.createdAt}`);
    lines.push(`> Stack: ${metadata.stack}`);
    if (metadata.detectedFeatures.length > 0) {
      lines.push(`> Features: ${metadata.detectedFeatures.join(', ')}`);
    }
    lines.push('');
    lines.push('## Brief');
    lines.push('');
    lines.push(metadata.brief);
    lines.push('');

    for (const phase of phases) {
      const depStr = phase.dependsOn.length > 0
        ? ` ← Phase ${phase.dependsOn.join(', ')}`
        : '';

      lines.push(`## Phase ${phase.id}: ${phase.name}${depStr}`);
      lines.push('');
      lines.push(phase.description);
      lines.push('');
      lines.push('### Tasks');
      lines.push('');

      for (const task of phase.tasks) {
        const files = task.targetFiles.length > 0
          ? ` → \`${task.targetFiles.join('`, `')}\``
          : '';
        lines.push(`- [ ] **${task.id}**: ${task.title} [${task.type}]${files}`);
      }

      lines.push('');
      lines.push('### Acceptance Criteria');
      lines.push('');
      for (const ac of phase.acceptanceCriteria) {
        lines.push(`- [ ] ${ac}`);
      }
      lines.push('');
    }

    // Summary
    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
    lines.push('---');
    lines.push('');
    lines.push(`**Summary**: ${phases.length} phases, ${totalTasks} tasks`);
    lines.push('');

    return lines.join('\n');
  }
}
