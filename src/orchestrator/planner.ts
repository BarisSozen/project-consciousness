/**
 * Orchestrator — Planner
 * 
 * Brief'ten task planı çıkarır.
 * Claude API kullanarak akıllı planlama yapar.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { 
  TaskPlan, 
  MemorySnapshot,
  OrchestratorConfig 
} from '../types/index.js';

const PLANNER_SYSTEM_PROMPT = `Sen bir proje planlama uzmanısın. 
Görevin: verilen brief ve mevcut proje hafızasını okuyarak bir task planı oluşturmak.

KURALLAR:
1. Her task atomik ve bağımsız olmalı (mümkün olduğunca)
2. Bağımlılıklar açıkça belirtilmeli
3. Paralel çalışabilecek task'lar gruplanmalı
4. Her task'ın kabul kriterleri net olmalı
5. Complexity tahmini gerçekçi olmalı
6. MISSION.md'deki amaçla %100 uyumlu olmalı

ÇIKTI FORMATI: JSON (TaskPlan tipinde)
`;

export class Planner {
  private client: Anthropic;
  private model: string;

  constructor(config: OrchestratorConfig) {
    this.client = new Anthropic({ apiKey: config.claudeApiKey });
    this.model = config.model;
  }

  async createPlan(brief: string, memory: MemorySnapshot): Promise<TaskPlan> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Brief
${brief}

## Mevcut MISSION.md
${memory.files.mission}

## Mevcut ARCHITECTURE.md
${memory.files.architecture}

## Mevcut DECISIONS.md
${memory.files.decisions}

## Mevcut STATE.md
${memory.files.state}

---

Bu brief ve mevcut hafıza dosyalarına dayanarak bir TaskPlan oluştur.
Yanıtını sadece JSON olarak ver, başka açıklama ekleme.`,
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    return this.parsePlan(text);
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
