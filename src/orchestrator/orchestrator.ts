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
import { AuditGate } from './audit-gate.js';
import { ContextAccumulator } from './context-accumulator.js';
import { TaskSplitter } from './task-splitter.js';
import { ShipCheck } from './ship-check.js';
import { DynamicScheduler } from './dynamic-scheduler.js';
import { ErrorPatternTracker } from './error-pattern-tracker.js';
import { FileLockManager, estimateTargetFiles } from './file-lock.js';
import { RecoveryManager } from './recovery.js';
import { OrphanDetector } from './orphan-detector.js';
import { resolveProvider } from '../llm/resolve.js';
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
  RetryContext,
  Phase,
  Decision,
} from '../types/index.js';

export class Orchestrator {
  private memory: MemoryLayer;
  private agentRunner: AgentRunner;
  private planner: Planner;
  private evaluator: Evaluator;
  private escalator: Escalator;
  private auditGate: AuditGate;
  private contextAccumulator: ContextAccumulator;
  private taskSplitter: TaskSplitter;
  private scheduler: DynamicScheduler;
  private errorTracker: ErrorPatternTracker;
  private fileLockManager: FileLockManager;
  private recovery: RecoveryManager;
  private orphanDetector: OrphanDetector;
  private config: OrchestratorConfig;
  private steps: OrchestrationStep[] = [];
  private sessionId: string;
  /** Full task list — plan'dan populate edilir */
  private taskMap: Map<string, TaskDefinition> = new Map();
  /** Retry contexts per task */
  private retryContexts: Map<string, RetryContext> = new Map();

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
    this.auditGate = new AuditGate(
      config.projectRoot,
      resolveProvider(config),
      (msg) => this.log(msg)
    );
    this.contextAccumulator = new ContextAccumulator(config.projectRoot);
    this.taskSplitter = new TaskSplitter();
    this.scheduler = new DynamicScheduler();
    this.errorTracker = new ErrorPatternTracker(config.projectRoot);
    this.fileLockManager = new FileLockManager();
    this.recovery = new RecoveryManager(config.projectRoot);
    this.orphanDetector = new OrphanDetector(config.projectRoot);
    this.sessionId = `session-${Date.now()}`;
  }

  // ── Ana Orkestrasyon Akışı ──────────────────────────────

  async run(brief: string): Promise<OrchestrationSession> {
    this.log(t().orchestratorStarting);

    // 0. Recovery check — önceki session'dan kalan checkpoint var mı?
    if (await this.recovery.canResume()) {
      const checkpoint = await this.recovery.loadCheckpoint();
      if (checkpoint) {
        const orphanReport = await this.orphanDetector.detect(checkpoint);
        if (orphanReport.hasOrphans) {
          this.log(this.orphanDetector.formatReport(orphanReport));
        }
        // TODO: Resume flow — şimdilik log'la, ileride tam entegrasyon
        this.log(`  📌 Önceki session checkpoint bulundu: ${checkpoint.completedTasks.length} task tamamlanmış`);
      }
    }

    // 0.5 Error pattern tracker'ı yükle
    await this.errorTracker.load();

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

    // 7. Post-build audit gate
    this.log('\n🔍 Running post-build audit...');
    const memoryFiles = await this.memory.readAll();
    const auditResult = await this.auditGate.run(memoryFiles);

    if (!auditResult.passed && auditResult.fixTasks.length > 0) {
      this.log(`\n🔧 Audit found ${auditResult.fixTasks.length} issues — generating fix tasks...`);

      // Log audit decision
      const auditDecisionId = await this.memory.getNextDecisionId();
      await this.memory.appendDecision({
        id: auditDecisionId,
        title: `Post-build audit: ${auditResult.passed ? 'PASSED' : 'FAILED'} (${auditResult.report.summary.healthScore}/100)`,
        date: new Date().toISOString(),
        context: `Automated audit after plan execution`,
        decision: auditResult.summary,
        rationale: `${auditResult.report.violations.length} violations, ${auditResult.fixTasks.length} fix tasks generated`,
        alternatives: 'Manual code review',
        status: 'active',
      });

      // Execute fix tasks
      const fixPlan: TaskPlan = {
        tasks: auditResult.fixTasks,
        executionOrder: [auditResult.fixTasks.map(t2 => t2.id)],
        estimatedSteps: auditResult.fixTasks.length,
      };

      for (const fixTask of auditResult.fixTasks) {
        this.taskMap.set(fixTask.id, fixTask);
      }

      this.log('\n── Audit Fix Round ──');
      await this.executePlan(fixPlan);

      // Re-audit after fix
      this.log('\n🔍 Re-auditing after fixes...');
      const reAudit = await this.auditGate.run(await this.memory.readAll());
      this.log(`  💯 Health: ${reAudit.report.summary.healthScore}/100 ${reAudit.passed ? '✅' : '⚠️ still below threshold'}`);
    }

    // 8. Ship readiness check
    this.log('\n🚀 Running ship readiness check...');
    const shipCheck = new ShipCheck(this.config.projectRoot, (msg) => this.log(msg));
    const shipResult = await shipCheck.run();
    this.log(`\n📦 Ship verdict: ${shipResult.verdict} (${shipResult.blockers} blockers, ${shipResult.warnings} warnings)\n`);

    // Log ship check as decision
    const shipDecisionId = await this.memory.getNextDecisionId();
    await this.memory.appendDecision({
      id: shipDecisionId,
      title: `Ship check: ${shipResult.verdict}`,
      date: new Date().toISOString(),
      context: 'Automated ship readiness verification',
      decision: shipResult.summary.slice(0, 500),
      rationale: `${shipResult.checks.filter(c => c.passed).length}/${shipResult.checks.length} checks passed`,
      alternatives: 'Manual integration testing',
      status: 'active',
    });

    // 9. Promote error patterns to LESSONS.md
    const lessons = this.errorTracker.toLessons(this.sessionId);
    if (lessons.length > 0) {
      this.log(`\n📚 ${lessons.length} error pattern(s) promoted to LESSONS.md`);
      for (const lesson of lessons) {
        await this.memory.appendLesson(lesson);
      }
    }
    await this.errorTracker.save();

    // 10. Clear checkpoint on successful completion
    await this.recovery.clearCheckpoint();
    this.fileLockManager.releaseAll();

    // 11. Session summary
    return {
      sessionId: this.sessionId,
      startedAt: new Date().toISOString(),
      brief,
      steps: this.steps,
      finalState: await this.memory.parseState(),
    };
  }

  // ── Plan Execution (Dynamic Scheduler) ──────────────────

  private async executePlan(plan: TaskPlan): Promise<void> {
    await this.transitionPhase('executing');

    // Initialize dynamic scheduler
    this.scheduler.loadTasks(plan.tasks);

    // Initialize checkpoint
    const memorySnap = await this.memory.snapshot();
    await this.recovery.saveCheckpoint({
      sessionId: this.sessionId,
      milestoneId: 'current',
      completedMilestones: [],
      completedTasks: [],
      timestamp: new Date().toISOString(),
      currentTaskId: null,
      completedSubTasks: [],
      pendingArtifacts: [],
      memoryHash: memorySnap.hash,
      executionGroupIndex: 0,
    });

    // Inject known pitfalls into agent context
    const pitfalls = this.errorTracker.getKnownPitfalls();
    if (pitfalls) {
      this.agentRunner.setKnownPitfalls(pitfalls);
    }

    // Event-driven execution loop
    let round = 0;
    while (!this.scheduler.isComplete()) {
      const ready = this.scheduler.getReady();
      if (ready.length === 0) break; // deadlock guard

      round++;
      const status = this.scheduler.getStatus();
      this.log(`\n── Round ${round} — ${ready.length} ready, ${status.running} running, ${status.completed}/${plan.tasks.length} done ──`);

      // Filter by file lock availability
      const runnable: TaskDefinition[] = [];
      const deferred: TaskDefinition[] = [];

      for (const task of ready) {
        const estimatedFiles = estimateTargetFiles(
          `${task.title} ${task.description}`,
          this.config.projectRoot
        );
        const lockResult = this.fileLockManager.acquire(task.id, estimatedFiles);
        if (lockResult.acquired) {
          runnable.push(task);
        } else {
          deferred.push(task);
          this.log(`  🔒 ${task.id} deferred — file conflict with ${lockResult.conflicts.map(c => c.heldBy).join(', ')}`);
        }
      }

      // Run tasks (up to maxParallelAgents)
      const batch = runnable.slice(0, this.config.maxParallelAgents);
      for (const task of batch) {
        this.scheduler.markRunning(task.id);
      }

      if (batch.length > 1) {
        // Parallel execution
        const memory = await this.memory.snapshot();
        const results = await this.agentRunner.runParallel(batch, memory, this.config.maxParallelAgents);

        for (const result of results) {
          this.fileLockManager.release(result.taskId);

          // Update checkpoint with pending artifacts
          for (const artifact of result.artifacts) {
            await this.recovery.addPendingArtifact(artifact);
          }

          if (result.success) {
            const newReady = this.scheduler.markDone(result.taskId);
            await this.evaluateAndProcess(result);
            await this.recovery.updateCheckpoint({
              completedTasks: [...(await this.recovery.loadCheckpoint())?.completedTasks ?? [], result.taskId],
              currentTaskId: null,
            });
            if (newReady.length > 0) {
              this.log(`  🔓 Unlocked: ${newReady.map(t2 => t2.id).join(', ')}`);
            }
          } else {
            const skipped = this.scheduler.markFailed(result.taskId);
            await this.evaluateAndProcess(result);
            if (skipped.length > 0) {
              this.log(`  ⏭️ Skipped (dependency failed): ${skipped.join(', ')}`);
            }
          }
        }
      } else if (batch.length === 1) {
        // Single task execution
        const task = batch[0]!;
        await this.recovery.updateCheckpoint({ currentTaskId: task.id });

        const result = await this.executeTask(task.id);
        this.fileLockManager.release(task.id);

        if (result) {
          for (const artifact of result.artifacts) {
            await this.recovery.addPendingArtifact(artifact);
          }

          if (result.success) {
            const newReady = this.scheduler.markDone(task.id);
            await this.evaluateAndProcess(result);
            await this.recovery.updateCheckpoint({
              completedTasks: [...(await this.recovery.loadCheckpoint())?.completedTasks ?? [], task.id],
              currentTaskId: null,
            });
            if (newReady.length > 0) {
              this.log(`  🔓 Unlocked: ${newReady.map(t2 => t2.id).join(', ')}`);
            }
          } else {
            const skipped = this.scheduler.markFailed(task.id);
            await this.evaluateAndProcess(result);
            if (skipped.length > 0) {
              this.log(`  ⏭️ Skipped (dependency failed): ${skipped.join(', ')}`);
            }
          }
        }
      }
    }

    // Log scheduler final status
    const finalStatus = this.scheduler.getStatus();
    this.log(`\n📊 Execution complete: ${finalStatus.completed} done, ${finalStatus.failed} failed, ${finalStatus.skipped} skipped`);

    await this.transitionPhase('reviewing');
    this.log(t().allTasksComplete);
  }

  // ── Task Execution — Gerçek Agent Runner Entegrasyonu ──

  private async executeTask(taskId: string): Promise<AgentResult | null> {
    this.log(t().taskStarting(taskId));

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

    // ── Adaptive Task Splitting ──
    const handoffContext = this.contextAccumulator.getMarkdown();
    const splitResult = this.taskSplitter.split(task, handoffContext || undefined);

    if (splitResult.wasSplit) {
      this.log(`  ✂️ Task split into ${splitResult.subTasks.length} sub-tasks (${splitResult.reason})`);

      // Execute sub-tasks sequentially
      const combinedArtifacts: string[] = [];
      let lastResult: AgentResult | null = null;

      for (const subTask of splitResult.subTasks) {
        this.taskMap.set(subTask.id, subTask);
        this.log(`  ── Sub-task: ${subTask.id} ──`);

        const subResult = await this.executeSingleTask(subTask);
        if (subResult) {
          lastResult = subResult;
          combinedArtifacts.push(...subResult.artifacts);

          // Evaluate sub-task
          await this.evaluateAndProcess(subResult);
        }
      }

      // Return combined result
      return lastResult ? {
        ...lastResult,
        taskId,
        artifacts: combinedArtifacts,
      } : null;
    }

    // No split needed — execute with handoff context injected
    const taskToRun = splitResult.original ?? task;
    return this.executeSingleTask(taskToRun);
  }

  private async executeSingleTask(task: TaskDefinition): Promise<AgentResult | null> {
    this.addStep({
      action: 'execute',
      taskId: task.id,
    });

    const memory = await this.memory.optimizedSnapshot();

    // Inject accumulated context into state for agent visibility
    const ctxMarkdown = this.contextAccumulator.getMarkdown();
    if (ctxMarkdown) {
      memory.files.state += '\n\n' + ctxMarkdown;
    }

    this.log(`  ${t().memorySnapshotTaken} (hash: ${memory.hash})`);

    const result = await this.agentRunner.runTask(task, memory);

    this.log(t().taskResult(task.id, result.success, result.duration));

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

    // Accumulate context from produced artifacts
    if (result.artifacts.length > 0) {
      const ctx = this.contextAccumulator.accumulate(result.artifacts);
      if (ctx.markdown) {
        this.log(`  📋 Context accumulated: ${ctx.files.length} files tracked`);
      }
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

    // Build RetryContext for feedback injection
    const specificFixes = evaluation.issues.map(i => `[${i.severity}] ${i.category}: ${i.description}`);
    const failedChecks = 'checks' in evaluation
      ? (evaluation as { checks: Array<{ name: string; passed: boolean }> }).checks
          .filter(c => !c.passed)
          .map(c => c.name)
      : [];

    const retryCtx: RetryContext = {
      taskId: result.taskId,
      attempt: retryCount + 1,
      previousOutput: result.output.slice(0, 2000),
      evaluationFeedback: evaluation.feedback ?? 'Quality checks failed.',
      specificFixes,
      failedChecks,
      lastError: result.output.slice(-500),
    };

    // Save retry context to checkpoint
    this.retryContexts.set(result.taskId, retryCtx);
    await this.recovery.setRetryContext(retryCtx);

    // Record error patterns for learning
    for (const issue of evaluation.issues) {
      this.errorTracker.record(
        result.taskId,
        issue.category === 'mission-drift' ? 'logic' :
        issue.category === 'architecture-violation' ? 'convention' :
        issue.category === 'scope-creep' ? 'anti-scope' : 'logic',
        issue.description,
        `Fix: ${issue.description}`
      );
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
      this.retryContexts.delete(result.taskId);
      await this.recovery.clearRetryContext();
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
