/**
 * Orchestrator — Ana Döngü
 * 
 * Plan → Execute → Evaluate → Update döngüsünü yönetir.
 * Her adımda hafızayı okur ve tutarlılığı denetler.
 */

import { MemoryLayer } from '../memory/index.js';
import { AgentRunner } from '../agent/index.js';
import { Planner } from './planner.js';
import { Evaluator } from './evaluator.js';
import { Escalator } from './escalator.js';
import type { 
  OrchestratorConfig,
  TaskPlan,
  TaskDefinition,
  OrchestrationStep,
  OrchestrationSession,
  AgentResult,
  EvaluationResult,
  EscalationResponse,
  Phase,
  Decision,
} from '../types/index.js';

export class Orchestrator {
  private memory: MemoryLayer;
  private agentRunner: AgentRunner;
  private planner: Planner;
  private evaluator: Evaluator;
  private escalator: Escalator;
  private config: OrchestratorConfig;
  private steps: OrchestrationStep[] = [];
  private sessionId: string;
  /** Full task list — plan'dan populate edilir */
  private taskMap: Map<string, TaskDefinition> = new Map();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.memory = new MemoryLayer(config.projectRoot);
    this.agentRunner = new AgentRunner({
      workingDirectory: config.projectRoot,
      timeout: 120_000,
      maxDepth: 3,
      log: (msg) => this.log(msg),
    });
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

    // 3.5 Task map'i doldur
    for (const task of plan.tasks) {
      this.taskMap.set(task.id, task);
    }

    // 3.6 Agent runner sağlık kontrolü
    const health = await this.agentRunner.checkHealth();
    this.log(`🏥 Agent runner: ${health.ready ? '✅' : '❌'} ${health.details}`);
    if (!health.ready) {
      this.log('⚠️ Agent runner hazır değil — stub modda devam edilecek');
    }

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
        // Paralel çalıştır — gerçek agent runner ile
        const memory = await this.memory.snapshot();
        const results = await this.agentRunner.runParallel(
          tasks,
          memory,
          this.config.maxParallelAgents
        );
        
        // Her sonucu değerlendir
        for (const result of results) {
          await this.evaluateAndProcess(result);
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

  // ── Task Execution — Gerçek Agent Runner Entegrasyonu ──

  private async executeTask(taskId: string): Promise<AgentResult | null> {
    this.log(`  ⚡ Task ${taskId} başlatılıyor...`);
    
    this.addStep({
      action: 'execute',
      taskId,
    });

    // Task tanımını bul
    const task = this.taskMap.get(taskId);
    if (!task) {
      this.log(`  ❌ Task ${taskId} tanımı bulunamadı`);
      return {
        taskId,
        agentId: 'unknown',
        success: false,
        output: `Task definition not found: ${taskId}`,
        artifacts: [],
        duration: 0,
      };
    }

    // Güncel memory snapshot al (her task öncesi)
    const memory = await this.memory.snapshot();
    this.log(`  📸 Memory snapshot (hash: ${memory.hash})`);

    // Agent runner ile çalıştır
    const result = await this.agentRunner.runTask(task, memory);

    this.log(`  ${result.success ? '✅' : '❌'} Task ${taskId}: ${result.success ? 'başarılı' : 'başarısız'} (${result.duration}ms)`);

    return result;
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
        const escResponse = await this.handleEscalation(evaluation);
        if (escResponse.action === 'continue') {
          await this.markTaskComplete(result);
        } else if (escResponse.action === 'skip') {
          await this.markTaskSkipped(result);
        } else if (escResponse.action === 'stop') {
          await this.transitionPhase('paused');
          throw new Error(`Orchestration paused by user at task ${result.taskId}`);
        }
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
    evaluation: EvaluationResult,
    retryCount = 0
  ): Promise<void> {
    const maxRetries = this.config.maxRetries;

    if (retryCount >= maxRetries) {
      this.log(`  🚨 Max retry (${maxRetries}) aşıldı — eskalasyon tetikleniyor`);
      const response = await this.handleEscalation(evaluation, retryCount);
      
      if (response.action === 'continue') {
        this.log('  ✅ Kullanıcı kabul etti, devam ediliyor');
        await this.markTaskComplete(result);
      } else if (response.action === 'skip') {
        this.log('  ⏭️ Kullanıcı atladı');
        await this.markTaskSkipped(result);
      } else if (response.action === 'stop') {
        this.log('  ⏹️ Kullanıcı durdurdu');
        await this.transitionPhase('paused');
        throw new Error(`Orchestration paused by user at task ${result.taskId}`);
      }
      return;
    }

    this.log(`  🔄 Retry ${retryCount + 1}/${maxRetries} — feedback ile agent'a gönderiliyor`);

    const task = this.taskMap.get(result.taskId);
    if (!task) {
      this.log(`  ❌ Task tanımı bulunamadı, kabul ediliyor`);
      await this.markTaskComplete(result);
      return;
    }

    // Feedback'i task açıklamasına ekle — agent'ın ne düzeltmesi gerektiğini bilsin
    const issueList = evaluation.issues
      .map(i => `- [${i.severity}] ${i.category}: ${i.description}`)
      .join('\n');

    const revisedTask: TaskDefinition = {
      ...task,
      description: `${task.description}

⚠️ RETRY ${retryCount + 1}/${maxRetries} — ÖNCEKİ DENEME BAŞARISIZ

Geri bildirim: ${evaluation.feedback ?? 'Kalite kontrolleri geçemedi.'}

Tespit edilen sorunlar:
${issueList || '- Genel kalite düşük'}

Skorlar: tutarlılık ${(evaluation.consistencyScore * 100).toFixed(0)}%, kalite ${(evaluation.qualityScore * 100).toFixed(0)}%, misyon ${(evaluation.missionAlignment * 100).toFixed(0)}%

BU SORUNLARI DÜZELT ve tekrar dene.`,
    };

    this.addStep({
      action: 'execute',
      taskId: result.taskId,
    });

    const memory = await this.memory.snapshot();
    const retryResult = await this.agentRunner.runTask(revisedTask, memory);

    this.log(`  ${retryResult.success ? '✅' : '❌'} Retry ${retryCount + 1} sonuç: ${retryResult.success ? 'başarılı' : 'başarısız'}`);

    // Yeni sonucu tekrar değerlendir
    const retryEval = await this.evaluator.evaluate(retryResult, memory);

    this.addStep({
      action: 'evaluate',
      taskId: retryResult.taskId,
      result: retryEval,
    });

    this.log(`  📊 Retry ${retryCount + 1} eval: ${retryEval.verdict}`);

    if (retryEval.verdict === 'accept') {
      this.log(`  ✅ Retry ${retryCount + 1} sonrası kabul edildi`);
      await this.markTaskComplete(retryResult);
    } else {
      // revise veya escalate → tekrar dene
      await this.handleRevision(retryResult, retryEval, retryCount + 1);
    }
  }

  private async handleEscalation(
    evaluation: EvaluationResult,
    retryCount?: number
  ): Promise<EscalationResponse> {
    const escalation = this.escalator.createEscalation(evaluation, retryCount);
    
    this.addStep({
      action: 'escalate',
      taskId: evaluation.taskId,
      result: evaluation,
    });

    const response = await this.escalator.promptUser(escalation);
    this.log(`  👤 Kullanıcı yanıtı: ${response.action}`);
    return response;
  }

  private async markTaskSkipped(result: AgentResult): Promise<void> {
    const state = await this.memory.parseState();
    const taskIdx = state.activeTasks.findIndex(t => t.taskId === result.taskId);
    
    if (taskIdx >= 0) {
      const task = state.activeTasks.splice(taskIdx, 1)[0]!;
      task.status = 'skipped';
      task.completedAt = new Date().toISOString();
      task.output = 'Skipped by user during escalation';
      state.completedTasks.push(task);
    }

    state.lastUpdated = new Date().toISOString();
    await this.memory.updateState(state);
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
