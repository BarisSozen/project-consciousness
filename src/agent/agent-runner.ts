/**
 * Agent Runner — Claude Code Instance Yöneticisi
 * 
 * Agent'ları spawn eder, memory context'i prompt'a enjekte eder,
 * çıktıyı parse eder ve orchestrator'a döndürür.
 * 
 * Karar D003: GSD-2 üstüne katman — subagent mekanizması kullanır
 * Karar D004: Agent'lar Claude Code ile çalışır
 */

import { ProcessSpawner } from './process-spawner.js';
import { ContextBuilder } from './context-builder.js';
import { OutputParser } from './output-parser.js';
import { t } from '../i18n/index.js';
import type { 
  AgentConfig, 
  AgentResult, 
  MemorySnapshot,
  TaskDefinition 
} from '../types/index.js';

export interface AgentRunnerConfig {
  /** Claude CLI binary path (default: 'claude') */
  binaryPath?: string;
  /** Working directory for agents */
  workingDirectory: string;
  /** Timeout per agent execution in ms (default: 120_000) */
  timeout?: number;
  /** Max recursion depth (prevents infinite agent spawning) */
  maxDepth?: number;
  /** Allowed tools for agents (default: ['Read', 'Write', 'Edit', 'Bash']) */
  allowedTools?: string[];
  /** Additional environment variables for agents */
  env?: Record<string, string>;
  /** Log function */
  log?: (message: string) => void;
}

export class AgentRunner {
  private agents: Map<string, AgentConfig> = new Map();
  private spawner: ProcessSpawner;
  private contextBuilder: ContextBuilder;
  private outputParser: OutputParser;
  private config: AgentRunnerConfig;
  private log: (message: string) => void;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
    this.spawner = new ProcessSpawner(
      config.binaryPath ?? 'claude',
      config.timeout ?? 120_000
    );
    this.contextBuilder = new ContextBuilder();
    this.outputParser = new OutputParser();
    this.log = config.log ?? console.log;

    this.registerDefaultAgents();
  }

  // ── Agent Registration ──────────────────────────────────

  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.agents.get(id);
  }

  private registerDefaultAgents(): void {
    this.registerAgent({
      id: 'coder',
      type: 'coder',
      capabilities: ['write-code', 'refactor', 'implement-feature'],
    });

    this.registerAgent({
      id: 'reviewer',
      type: 'reviewer',
      capabilities: ['code-review', 'consistency-check', 'quality-audit'],
    });

    this.registerAgent({
      id: 'tester',
      type: 'tester',
      capabilities: ['write-tests', 'run-tests', 'coverage-analysis'],
    });

    this.registerAgent({
      id: 'documenter',
      type: 'documenter',
      capabilities: ['write-docs', 'update-readme', 'api-docs'],
    });
  }

  // ── Health Check ────────────────────────────────────────

  async checkHealth(): Promise<{ ready: boolean; details: string }> {
    // Sonsuz döngü koruması
    const depth = parseInt(process.env['PC_AGENT_DEPTH'] ?? '0', 10);
    if (depth >= (this.config.maxDepth ?? 3)) {
      return { 
        ready: false, 
        details: `Max agent depth reached (${depth}/${this.config.maxDepth ?? 3})` 
      };
    }

    const health = await this.spawner.healthCheck();
    if (!health.available) {
      return {
        ready: false,
        details: `Claude CLI not available: ${health.error}`,
      };
    }

    return {
      ready: true,
      details: `Claude CLI ${health.version ?? 'unknown'} ready, depth: ${depth}`,
    };
  }

  // ── Single Task Execution ───────────────────────────────

  async runTask(
    task: TaskDefinition,
    memory: MemorySnapshot
  ): Promise<AgentResult> {
    const agentId = this.selectAgent(task);
    const agent = this.agents.get(agentId);

    if (!agent) {
      return this.failResult(task.id, agentId, `No agent found for type: ${task.type}`);
    }

    this.log(t().agentStarting(agent.id, task.id));

    // 1. Memory-aware prompt oluştur
    const prompt = this.contextBuilder.buildPrompt(task, memory, agent);
    this.log(t().promptReady(prompt.length));

    // 2. Claude CLI spawn et
    const startTime = Date.now();
    
    try {
      // Build CLI flags for tool permissions
      const flags = this.buildCliFlags();

      const processResult = await this.spawner.spawn({
        prompt,
        cwd: this.config.workingDirectory,
        timeout: this.config.timeout,
        flags,
        env: this.config.env,
      });

      // 3. Timeout kontrolü
      if (processResult.timedOut) {
        this.log(t().agentTimeout(processResult.duration));
        return this.failResult(
          task.id, 
          agent.id, 
          `Agent timed out after ${processResult.duration}ms`,
          processResult.duration
        );
      }

      // 4. Çıktıyı parse et
      const result = this.outputParser.parse(
        task.id,
        agent.id,
        processResult.stdout,
        processResult.stderr,
        processResult.exitCode,
        processResult.duration
      );

      this.log(`  ${result.success ? '✅' : '❌'} ${t().agentComplete(agent.id, processResult.duration)}`);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(t().agentError(agent.id, message));
      return this.failResult(task.id, agent.id, message, duration);
    }
  }

  // ── Parallel Execution ──────────────────────────────────

  async runParallel(
    tasks: TaskDefinition[],
    memory: MemorySnapshot,
    maxConcurrent: number
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    this.log(t().parallelBatch(0, Math.ceil(tasks.length / maxConcurrent), tasks.map(t2 => t2.id).join(', ')));

    // Batch'ler halinde çalıştır
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(tasks.length / maxConcurrent);
      
      this.log(t().parallelBatch(batchNum, totalBatches, batch.map(t2 => t2.id).join(', ')));

      // Her batch'te memory'yi yeniden oku (önceki batch'in değişiklikleri yansısın)
      // İlk batch hariç — ilk batch zaten güncel memory'yi kullanıyor
      const batchResults = await Promise.all(
        batch.map(task => this.runTask(task, memory))
      );

      results.push(...batchResults);

      // Batch sonuçlarını logla
      const succeeded = batchResults.filter(r => r.success).length;
      this.log(t().batchResult(batchNum, succeeded, batchResults.length));
    }

    return results;
  }

  // ── CLI Flags ────────────────────────────────────────────

  private buildCliFlags(): string[] {
    const flags: string[] = [];

    // Permission bypass — agent'lar sandbox'ta çalışır, tool'ları kullanabilmeli
    flags.push('--dangerously-skip-permissions');

    // Allowed tools — sadece dosya operasyonları ve bash
    const tools = this.config.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash'];
    if (tools.length > 0) {
      flags.push('--allowedTools', tools.join(','));
    }

    return flags;
  }

  // ── Agent Selection ─────────────────────────────────────

  private selectAgent(task: TaskDefinition): string {
    // Task'a explicit agent atanmışsa onu kullan
    if (task.agent) {
      return task.agent;
    }

    // Task type'a göre agent seç
    switch (task.type) {
      case 'code': return 'coder';
      case 'review': return 'reviewer';
      case 'test': return 'tester';
      case 'document': return 'documenter';
      case 'decision': return 'coder';
      default: return 'coder';
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  private failResult(
    taskId: string, 
    agentId: string, 
    error: string,
    duration = 0
  ): AgentResult {
    return {
      taskId,
      agentId,
      success: false,
      output: `Error: ${error}`,
      artifacts: [],
      duration,
    };
  }
}
