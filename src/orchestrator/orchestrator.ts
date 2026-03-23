/**
 * Orchestrator — Ana Döngü
 * 
 * Plan → Execute → Evaluate → Update döngüsünü yönetir.
 * Her adımda hafızayı okur ve tutarlılığı denetler.
 */

import { MemoryLayer } from '../memory/index.js';
import { Planner } from './planner.js';
import { Evaluator } from './evaluator.js';
import { Escalator } from './escalator.js';
import type { 
  OrchestratorConfig,
  TaskPlan,
  OrchestrationStep,
  OrchestrationSession,
  AgentResult,
  EvaluationResult,
  Phase,
  Decision,
} from '../types/index.js';

export class Orchestrator {
  private memory: MemoryLayer;
  private planner: Planner;
  private evaluator: Evaluator;
  private escalator: Escalator;
  private config: OrchestratorConfig;
  private steps: OrchestrationStep[] = [];
  private sessionId: string;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.memory = new MemoryLayer(config.projectRoot);
    this.planner = new Planner(config);
    this.evaluator = new Evaluator(config);
    this.escalator = new Escalator();
    this.sessionId = `session-${Date.now()}`;
  }

  // ── Ana Orkestrasyon Akışı ──────────────────────────────

  async run(brief: string): Promise<OrchestrationSession> {
    this.log('🚀 Orkestrasyon başlıyor...');
    
    // 1. Hafıza bütünlüğünü doğrula
    await this.validateMemory();

    // 2. Hafıza snapshot'ı al
    const memory = await this.memory.snapshot();
    this.log(`📸 Hafıza snapshot alındı (hash: ${memory.hash})`);

    // 3. Plan oluştur
    this.log('📋 Plan oluşturuluyor...');
    const plan = await this.planner.createPlan(brief, memory);
    this.log(`✅ Plan hazır: ${plan.tasks.length} task, ${plan.executionOrder.length} adım`);

    // 4. Planı kaydet — karar olarak logla
    await this.logPlanDecision(plan);

    // 5. State'i güncelle
    await this.transitionPhase('planning');

    // 6. Execution loop
    await this.executePlan(plan);

    // 7. Session özeti
    return {
      sessionId: this.sessionId,
      startedAt: new Date().toISOString(),
      brief,
      steps: this.steps,
      finalState: await this.memory.parseState(),
    };
  }

  // ── Plan Execution ──────────────────────────────────────

  private async executePlan(plan: TaskPlan): Promise<void> {
    await this.transitionPhase('executing');

    for (let groupIdx = 0; groupIdx < plan.executionOrder.length; groupIdx++) {
      const group = plan.executionOrder[groupIdx]!;
      this.log(`\n── Adım ${groupIdx + 1}/${plan.executionOrder.length}: [${group.join(', ')}] ──`);

      // Her task grubunu yürüt (paralel veya sıralı)
      const tasks = group
        .map(id => plan.tasks.find(t => t.id === id))
        .filter((t): t is NonNullable<typeof t> => t != null);

      if (tasks.length <= this.config.maxParallelAgents) {
        // Paralel çalıştır
        const results = await Promise.all(
          tasks.map(task => this.executeTask(task.id))
        );
        
        // Her sonucu değerlendir
        for (const result of results) {
          if (result) {
            await this.evaluateAndProcess(result);
          }
        }
      } else {
        // Sıralı çalıştır
        for (const task of tasks) {
          const result = await this.executeTask(task.id);
          if (result) {
            await this.evaluateAndProcess(result);
          }
        }
      }
    }

    await this.transitionPhase('reviewing');
    this.log('\n🏁 Tüm task\'lar tamamlandı, review aşamasında.');
  }

  // ── Task Execution (stub — agent runner entegrasyonu gelecek) ──

  private async executeTask(taskId: string): Promise<AgentResult | null> {
    this.log(`  ⚡ Task ${taskId} başlatılıyor...`);
    
    this.addStep({
      action: 'execute',
      taskId,
    });

    // TODO: Gerçek agent runner entegrasyonu
    // Şimdilik stub result döndürüyoruz
    return {
      taskId,
      agentId: 'stub-agent',
      success: true,
      output: `Task ${taskId} completed (stub)`,
      artifacts: [],
      duration: 0,
    };
  }

  // ── Evaluation + Processing ─────────────────────────────

  private async evaluateAndProcess(result: AgentResult): Promise<void> {
    const memory = await this.memory.snapshot();
    const evaluation = await this.evaluator.evaluate(result, memory);
    
    this.addStep({
      action: 'evaluate',
      taskId: result.taskId,
      result: evaluation,
    });

    this.log(`  📊 Değerlendirme: ${evaluation.verdict} (tutarlılık: ${evaluation.consistencyScore}, kalite: ${evaluation.qualityScore}, misyon: ${evaluation.missionAlignment})`);

    switch (evaluation.verdict) {
      case 'accept':
        this.log(`  ✅ Kabul edildi.`);
        await this.markTaskComplete(result);
        break;

      case 'revise':
        this.log(`  🔄 Revize gerekli.`);
        await this.handleRevision(result, evaluation);
        break;

      case 'escalate':
        this.log(`  🚨 Eskalasyon gerekli!`);
        await this.handleEscalation(evaluation);
        break;
    }

    // State güncelle
    await this.updateStateAfterTask(result, evaluation);
  }

  // ── Handlers ────────────────────────────────────────────

  private async markTaskComplete(result: AgentResult): Promise<void> {
    const state = await this.memory.parseState();
    const taskIdx = state.activeTasks.findIndex(t => t.taskId === result.taskId);
    
    if (taskIdx >= 0) {
      const task = state.activeTasks.splice(taskIdx, 1)[0]!;
      task.status = 'done';
      task.output = result.output;
      task.completedAt = new Date().toISOString();
      state.completedTasks.push(task);
    }

    state.lastUpdated = new Date().toISOString();
    await this.memory.updateState(state);
  }

  private async handleRevision(
    result: AgentResult, 
    evaluation: EvaluationResult
  ): Promise<void> {
    // TODO: Agent'a geri bildirim gönder ve tekrar çalıştır
    this.log(`  📝 Geri bildirim: ${evaluation.feedback ?? 'Belirtilmemiş'}`);
    
    // Şimdilik revizyon sonrası kabul et
    await this.markTaskComplete(result);
  }

  private async handleEscalation(evaluation: EvaluationResult): Promise<void> {
    const escalation = this.escalator.createEscalation(evaluation);
    const formatted = this.escalator.formatForHuman(escalation);
    
    this.addStep({
      action: 'escalate',
      taskId: evaluation.taskId,
      result: evaluation,
    });

    // TODO: Gerçek kullanıcı etkileşimi
    console.log(formatted);
    this.log('  ⏳ Kullanıcı yanıtı bekleniyor...');
  }

  // ── State Management ────────────────────────────────────

  private async transitionPhase(phase: Phase): Promise<void> {
    const state = await this.memory.parseState();
    state.phase = phase;
    state.iteration += 1;
    state.lastUpdated = new Date().toISOString();
    await this.memory.updateState(state);
    this.log(`📌 Faz geçişi: ${phase}`);
  }

  private async updateStateAfterTask(
    result: AgentResult,
    _evaluation: EvaluationResult
  ): Promise<void> {
    this.addStep({
      action: 'update-state',
      taskId: result.taskId,
    });
  }

  // ── Validation ──────────────────────────────────────────

  private async validateMemory(): Promise<void> {
    const isValid = await this.memory.validateMissionIntegrity();
    if (!isValid) {
      throw new Error('MISSION.md integrity check failed — temel bölümler eksik');
    }
    this.log('✅ Hafıza bütünlüğü doğrulandı');
  }

  // ── Decision Logging ────────────────────────────────────

  private async logPlanDecision(plan: TaskPlan): Promise<void> {
    const nextId = await this.memory.getNextDecisionId();
    const decision: Decision = {
      id: nextId,
      title: `Plan Oluşturuldu — ${plan.tasks.length} task`,
      date: new Date().toISOString(),
      context: `Orchestrator brief'ten plan üretti`,
      decision: `${plan.executionOrder.length} adımda ${plan.tasks.length} task yürütülecek`,
      rationale: `Task bağımlılıkları ve parallellik analizi sonucu`,
      alternatives: 'Tek seferde tüm task\'ları sıralı çalıştırmak',
      status: 'active',
    };
    await this.memory.appendDecision(decision);
  }

  // ── Helpers ─────────────────────────────────────────────

  private addStep(partial: Partial<OrchestrationStep>): void {
    this.steps.push({
      stepNumber: this.steps.length + 1,
      phase: 'executing',
      action: partial.action ?? 'execute',
      taskId: partial.taskId,
      result: partial.result,
      timestamp: new Date().toISOString(),
    });
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}
