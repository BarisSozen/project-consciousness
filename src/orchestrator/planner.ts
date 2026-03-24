/**
 * Orchestrator — Planner
 * 
 * Brief'ten task planı çıkarır.
 * LLM provider abstraction ile herhangi bir model kullanabilir.
 */

import type { LLMProvider } from '../llm/types.js';
import { resolveProvider } from '../llm/resolve.js';
import { t } from '../i18n/index.js';
import type { 
  TaskPlan, 
  MemorySnapshot,
  OrchestratorConfig 
} from '../types/index.js';

export class Planner {
  private provider: LLMProvider | null;

  constructor(config: OrchestratorConfig) {
    this.provider = resolveProvider(config);
  }

  async createPlan(brief: string, memory: MemorySnapshot): Promise<TaskPlan> {
    if (!this.provider) {
      throw new Error('LLM provider required for planning');
    }

    const response = await this.provider.chat(
      [
        {
          role: 'user',
          content: `## Brief
${brief}

## MISSION.md
${memory.files.mission}

## ARCHITECTURE.md
${memory.files.architecture}

## DECISIONS.md
${memory.files.decisions}

## STATE.md
${memory.files.state}

---

Create a TaskPlan based on this brief and the current memory files.
Respond with JSON only, no extra explanation.`,
        },
      ],
      {
        system: t().plannerSystemPrompt,
        maxTokens: 4096,
      }
    );

    return this.parsePlan(response.text);
  }

  private parsePlan(rawResponse: string): TaskPlan {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/) 
      ?? [null, rawResponse];
    
    const jsonStr = jsonMatch[1]?.trim() ?? rawResponse.trim();
    
    try {
      const parsed = JSON.parse(jsonStr) as TaskPlan;
      return this.validatePlan(parsed);
    } catch (error) {
      throw new Error(`Failed to parse plan from LLM response: ${error}`);
    }
  }

  private validatePlan(plan: TaskPlan): TaskPlan {
    if (!plan.tasks || plan.tasks.length === 0) {
      throw new Error('Plan must contain at least one task');
    }

    if (!plan.executionOrder || plan.executionOrder.length === 0) {
      throw new Error('Plan must define execution order');
    }

    // Validate all task IDs in executionOrder exist in tasks
    const taskIds = new Set(plan.tasks.map(t => t.id));
    for (const group of plan.executionOrder) {
      for (const id of group) {
        if (!taskIds.has(id)) {
          throw new Error(`Execution order references unknown task: ${id}`);
        }
      }
    }

    // Validate dependency references
    for (const task of plan.tasks) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          throw new Error(`Task ${task.id} depends on unknown task: ${dep}`);
        }
      }
    }

    return plan;
  }
}
