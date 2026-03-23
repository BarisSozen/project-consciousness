/**
 * Agent Runner — Claude Code Instance Yöneticisi
 * 
 * Agent'ları spawn eder, context hazırlar, çıktı toplar.
 * GSD subagent mekanizması üstüne oturur.
 */

import type { 
  AgentConfig, 
  AgentTask, 
  AgentResult, 
  MemorySnapshot,
  TaskDefinition 
} from '../types/index.js';

export class AgentRunner {
  private agents: Map<string, AgentConfig> = new Map();

  constructor() {
    this.registerDefaultAgents();
  }

  // ── Agent Registration ──────────────────────────────────

  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
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

  // ── Task Execution ──────────────────────────────────────

  async runTask(
    task: TaskDefinition,
    memory: MemorySnapshot
  ): Promise<AgentResult> {
    const agentId = this.selectAgent(task);
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`No agent found for task type: ${task.type}`);
    }

    const agentTask: AgentTask = {
      taskDefinition: task,
      memorySnapshot: memory,
      additionalContext: this.buildContext(task, memory),
    };

    const startTime = Date.now();

    try {
      const output = await this.executeAgent(agent, agentTask);
      
      return {
        taskId: task.id,
        agentId: agent.id,
        success: true,
        output,
        artifacts: [],
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        taskId: task.id,
        agentId: agent.id,
        success: false,
        output: '',
        artifacts: [],
        duration: Date.now() - startTime,
      };
    }
  }

  // ── Parallel Execution ──────────────────────────────────

  async runParallel(
    tasks: TaskDefinition[],
    memory: MemorySnapshot,
    maxConcurrent: number
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    
    // Process in batches of maxConcurrent
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(task => this.runTask(task, memory))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ── Agent Selection ─────────────────────────────────────

  private selectAgent(task: TaskDefinition): string {
    // Task type'a göre agent seç
    switch (task.type) {
      case 'code': return 'coder';
      case 'review': return 'reviewer';
      case 'test': return 'tester';
      case 'document': return 'documenter';
      case 'decision': return 'coder'; // decision task'ları da coder handle eder
      default: return 'coder';
    }
  }

  // ── Context Building ────────────────────────────────────

  private buildContext(task: TaskDefinition, memory: MemorySnapshot): string {
    return `
## Task Context

### Misyon (ASLA UNUTMA)
${memory.files.mission}

### İlgili Mimari Kararlar
${memory.files.architecture}

### Geçmiş Kararlar
${memory.files.decisions}

### Şu Anki Durum
${memory.files.state}

### Görev Detayı
- ID: ${task.id}
- Başlık: ${task.title}
- Açıklama: ${task.description}
- Kabul Kriterleri:
${task.acceptanceCriteria.map(c => `  - ${c}`).join('\n')}

### ÖNEMLİ
1. Misyondan SAPMA. Her ürettiğin çıktı MISSION.md ile uyumlu olmalı.
2. Mimari kararları İHLAL ETME. ARCHITECTURE.md'yi oku ve uy.
3. Önceki kararlarla ÇELİŞME. DECISIONS.md'yi kontrol et.
4. Kapsamı AŞMA. Sadece tanımlanan task'ı yap.
`;
  }

  // ── Agent Execution (stub — gerçek implementasyon gelecek) ──

  private async executeAgent(
    _agent: AgentConfig, 
    _task: AgentTask
  ): Promise<string> {
    // TODO: Gerçek Claude Code / subagent entegrasyonu
    // Bu stub, GSD subagent mekanizması ile replace edilecek
    return `Agent executed task successfully (stub implementation)`;
  }
}
