/**
 * Orchestrator — Evaluator
 * 
 * Agent çıktısını hafızaya karşı değerlendirir.
 * Tutarlılık, kalite ve misyon uyumu skorları üretir.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { 
  EvaluationResult, 
  AgentResult, 
  MemorySnapshot,
  OrchestratorConfig 
} from '../types/index.js';

const EVALUATOR_SYSTEM_PROMPT = `Sen bir kalite ve tutarlılık denetçisisin.
Görevin: Bir agent'ın task çıktısını projenin hafıza dosyalarına karşı değerlendirmek.

DEĞERLENDİRME KRİTERLERİ:
1. consistencyScore (0-1): Çıktı, mevcut mimari ve kararlarla tutarlı mı?
2. qualityScore (0-1): Çıktı kabul edilebilir kalitede mi?
3. missionAlignment (0-1): Çıktı, MISSION.md'deki amaçla uyumlu mu?

SORUN KATEGORİLERİ:
- mission-drift: Misyondan sapma
- architecture-violation: Mimari kural ihlali
- decision-conflict: Önceki kararlarla çelişki
- scope-creep: Kapsam dışına çıkma

KARAR:
- accept: Tüm skorlar > 0.7, kritik sorun yok
- revise: Herhangi bir skor 0.4-0.7 arası veya warning var
- escalate: Herhangi bir skor < 0.4 veya kritik sorun var

ÇIKTI: JSON (EvaluationResult tipinde)
`;

export class Evaluator {
  private client: Anthropic;
  private model: string;
  private escalationThreshold: number;

  constructor(config: OrchestratorConfig) {
    this.client = new Anthropic({ apiKey: config.claudeApiKey });
    this.model = config.model;
    this.escalationThreshold = config.escalationThreshold;
  }

  async evaluate(
    agentResult: AgentResult,
    memory: MemorySnapshot
  ): Promise<EvaluationResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: EVALUATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Agent Çıktısı
Task ID: ${agentResult.taskId}
Agent: ${agentResult.agentId}
Başarılı: ${agentResult.success}
Çıktı:
${agentResult.output}

Üretilen/Değiştirilen Dosyalar: ${agentResult.artifacts.join(', ') || 'yok'}

## MISSION.md
${memory.files.mission}

## ARCHITECTURE.md
${memory.files.architecture}

## DECISIONS.md
${memory.files.decisions}

## STATE.md
${memory.files.state}

---

Bu agent çıktısını hafıza dosyalarına karşı değerlendir.
Yanıtını sadece JSON olarak ver.`,
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    return this.parseEvaluation(text, agentResult.taskId);
  }

  private parseEvaluation(rawResponse: string, taskId: string): EvaluationResult {
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/) 
      ?? [null, rawResponse];
    
    const jsonStr = jsonMatch[1]?.trim() ?? rawResponse.trim();

    try {
      const parsed = JSON.parse(jsonStr) as EvaluationResult;
      parsed.taskId = taskId;
      return this.applyThresholds(parsed);
    } catch {
      // LLM parse edilemezse conservative default
      return {
        taskId,
        consistencyScore: 0.5,
        qualityScore: 0.5,
        missionAlignment: 0.5,
        issues: [{
          severity: 'warning',
          category: 'mission-drift',
          description: 'Evaluation response could not be parsed — manual review recommended',
        }],
        verdict: 'escalate',
        feedback: 'Automated evaluation failed, escalating for human review.',
      };
    }
  }

  private applyThresholds(result: EvaluationResult): EvaluationResult {
    const minScore = Math.min(
      result.consistencyScore,
      result.qualityScore,
      result.missionAlignment
    );

    const hasCritical = result.issues.some(i => i.severity === 'critical');

    if (hasCritical || minScore < this.escalationThreshold) {
      result.verdict = 'escalate';
    } else if (minScore < 0.7 || result.issues.some(i => i.severity === 'warning')) {
      result.verdict = 'revise';
    } else {
      result.verdict = 'accept';
    }

    return result;
  }
}
