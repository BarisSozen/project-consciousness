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
import { t, setLocale } from '../i18n/index.js';
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

    // Set locale if configured
    if (config.locale) {
      setLocale(config.locale);
    }

    this.memory = new MemoryLayer(config.projectRoot);
    this.agentRunner = new AgentRunner({
      workingDirectory: config.projectRoot,
      binaryPath: config.agentBinary,
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
    this.log(t().orchestratorStarting);
    
    // 1. Validate memory integrity
    await this.validateMemory();

    // 2. Hafıza snapshot'ı al
    const memory = await this.memory.optimizedSnapshot();
    this.log(`${t().memorySnapshotTaken} (hash: ${memory.hash}, optimized)`);

    // 3. Create plan
    this.log(t().planCreating);
    const plan = await this.planner.createPlan(brief, memory);
    this.log(t().planReady(plan.tasks.length, plan.executionOrder.length));

    // 3.5 Task map'i doldur
    for (const task of plan.tasks) {
      this.taskMap.set(task.id, task);
    }

    // 3.6 Agent runner health check
    const health = await this.agentRunner.checkHealth();
    this.log(t().agentRunnerHealth(health.ready, health.details));
    if (!health.ready) {
      this.log('⚠️ Agent runner not ready — continuing in stub mode');
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
      this.log(t().stepHeader(groupIdx + 1, plan.executionOrder.length, group.join(', ')));

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
    this.log(t().allTasksComplete);
  }

  // ── Task Execution — Gerçek Agent Runner Entegrasyonu ──

  private async executeTask(taskId: string): Promise<AgentResult | null> {
    this.log(t().taskStarting(taskId));
    
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

    const memory = await this.memory.optimizedSnapshot();
    this.log(`  ${t().memorySnapshotTaken} (hash: ${memory.hash})`);

    const result = await this.agentRunner.runTask(task, memory);

    this.log(t().taskResult(taskId, result.success, result.duration));

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

    this.log(t().evalResult(evaluation.verdict, evaluation.consistencyScore, evaluation.qualityScore, evaluation.missionAlignment));

    switch (evaluation.verdict) {
      case 'accept':
        this.log(t().accepted);
        await this.markTaskComplete(result);
        break;

      case 'revise':
        this.log(t().reviseNeeded);
        await this.handleRevision(result, evaluation);
        break;

      case 'escalate':
        this.log(t().escalationNeeded);
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
      this.log(`  🚨 Max retry (${maxRetries}) exceeded — triggering escalation`);
      const response = await this.handleEscalation(evaluation, retryCount);
      
      if (response.action === 'continue') {
        this.log('  ✅ User accepted, continuing');
        await this.markTaskComplete(result);
      } else if (response.action === 'skip') {
        this.log('  ⏭️ User skipped');
        await this.markTaskSkipped(result);
      } else if (response.action === 'stop') {
        this.log('  ⏹️ User stopped');
        await this.transitionPhase('paused');
        throw new Error(`Orchestration paused by user at task ${result.taskId}`);
      }
      return;
    }

    this.log(`  🔄 Retry ${retryCount + 1}/${maxRetries} — sending to agent with feedback`);

    const task = this.taskMap.get(result.taskId);
    if (!task) {
      this.log(`  ❌ Task definition not found, accepting`);
      await this.markTaskComplete(result);
      return;
    }

    const locale = t();
    const issueList = evaluation.issues
      .map(i => `- [${i.severity}] ${i.category}: ${i.description}`)
      .join('\n');

    const revisedTask: TaskDefinition = {
      ...task,
      description: `${task.description}

${locale.retryHeader(retryCount + 1, maxRetries)}

${locale.retryFeedback}: ${evaluation.feedback ?? 'Quality checks failed.'}

${locale.retryIssues}:
${issueList || '- General quality below threshold'}

${locale.retryScores(evaluation.consistencyScore, evaluation.qualityScore, evaluation.missionAlignment)}

${locale.retryFixInstruction}`,
    };

    this.addStep({
      action: 'execute',
      taskId: result.taskId,
    });

    const memory = await this.memory.snapshot();
    const retryResult = await this.agentRunner.runTask(revisedTask, memory);

    this.log(`  ${retryResult.success ? '✅' : '❌'} Retry ${retryCount + 1}: ${retryResult.success ? 'succeeded' : 'failed'}`);

    // Yeni sonucu tekrar değerlendir
    const retryEval = await this.evaluator.evaluate(retryResult, memory);

    this.addStep({
      action: 'evaluate',
      taskId: retryResult.taskId,
      result: retryEval,
    });

    this.log(`  📊 Retry ${retryCount + 1} eval: ${retryEval.verdict}`);

    if (retryEval.verdict === 'accept') {
      this.log(`  ✅ Accepted after retry ${retryCount + 1}`);
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
    this.log(t().userResponse(response.action));
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
    this.log(t().phaseTransition(phase));
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
      throw new Error(t().missionIntegrityFailed);
    }
    this.log(t().memoryValidated);
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
