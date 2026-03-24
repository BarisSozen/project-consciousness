/**
 * Orchestrator — Escalator
 * 
 * İnsan müdahalesi gereken durumları yönetir.
 * Terminal'den gerçek readline ile kullanıcı yanıtı alır.
 * 
 * Tasarım ilkesi #2: Fail-Safe — şüphe durumunda insana sor
 */

import { createInterface } from 'node:readline';
import { t } from '../i18n/index.js';
import type { 
  EscalationRequest,
  EscalationResponse,
  EvaluationResult,
} from '../types/index.js';

export class Escalator {
  /** Readline override (test injection) */
  private _askFn: ((prompt: string) => Promise<string>) | null = null;

  /**
   * Test'ler için readline'ı override et
   */
  setAskFn(fn: (prompt: string) => Promise<string>): void {
    this._askFn = fn;
  }

  /**
   * Değerlendirme sonucuna göre eskalasyon gerekip gerekmediğine karar verir
   */
  shouldEscalate(evaluation: EvaluationResult): boolean {
    return evaluation.verdict === 'escalate';
  }

  /**
   * Eskalasyon request'i oluşturur
   */
  createEscalation(evaluation: EvaluationResult, retryCount?: number): EscalationRequest {
    const criticalIssues = evaluation.issues.filter(i => i.severity === 'critical');
    const hasScoreDrop = Math.min(
      evaluation.consistencyScore,
      evaluation.qualityScore,
      evaluation.missionAlignment
    ) < 0.4;

    return {
      taskId: evaluation.taskId,
      reason: this.formatReason(evaluation),
      context: this.formatContext(evaluation, retryCount),
      options: this.generateOptions(evaluation),
      urgency: criticalIssues.length > 0 ? 'blocking' : 
               hasScoreDrop ? 'important' : 'informational',
      retryCount,
    };
  }

  /**
   * Eskalasyonu terminal'e yaz ve kullanıcıdan yanıt al
   */
  async promptUser(escalation: EscalationRequest): Promise<EscalationResponse> {
    const formatted = this.formatForHuman(escalation);
    console.log(formatted);

    const answer = await this.ask(t().escalationPrompt);

    return this.parseResponse(answer.trim());
  }

  /**
   * Eskalasyonu insan tarafından okunabilir formatta render eder
   */
  formatForHuman(escalation: EscalationRequest): string {
    const locale = t();
    const urgencyEmoji = {
      blocking: '🚨',
      important: '⚠️',
      informational: 'ℹ️',
    };

    const retryInfo = escalation.retryCount != null 
      ? `\n🔄 Retry: ${escalation.retryCount}` 
      : '';

    return `
${urgencyEmoji[escalation.urgency]} ${locale.escalationTitle(escalation.taskId)}
${'═'.repeat(50)}

📋 ${locale.escalationReason}: ${escalation.reason}
${retryInfo}
📝 ${locale.escalationContext}:
${escalation.context}

🔀 ${locale.escalationOptions}:
  1. ${locale.escalationOptionContinue}
  2. ${locale.escalationOptionSkip}
  3. ${locale.escalationOptionStop}
`;
  }

  /**
   * Kullanıcı yanıtını parse et
   */
  parseResponse(input: string): EscalationResponse {
    const lower = input.toLowerCase();

    // Numara ile seçim
    if (lower === '1' || lower.startsWith('devam')) {
      return { action: 'continue' };
    }
    if (lower === '2' || lower.startsWith('atla') || lower.startsWith('skip')) {
      return { action: 'skip' };
    }
    if (lower === '3' || lower.startsWith('dur') || lower.startsWith('stop')) {
      return { action: 'stop' };
    }
    if (lower.startsWith('retry') || lower.startsWith('tekrar')) {
      return { action: 'retry', feedback: input };
    }

    // Default: devam et
    return { action: 'continue', feedback: input };
  }

  // ── Private ─────────────────────────────────────────────

  private formatReason(evaluation: EvaluationResult): string {
    const issues = evaluation.issues
      .filter(i => i.severity === 'critical' || i.severity === 'warning');
    
    if (issues.length > 0) {
      return issues.map(i => `[${i.category}] ${i.description}`).join('; ');
    }

    const scores = {
      tutarlılık: evaluation.consistencyScore,
      kalite: evaluation.qualityScore,
      'misyon uyumu': evaluation.missionAlignment,
    };

    const lowScores = Object.entries(scores)
      .filter(([_, v]) => v < 0.5)
      .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`);

    return `Düşük skorlar: ${lowScores.join(', ')}`;
  }

  private formatContext(evaluation: EvaluationResult, retryCount?: number): string {
    const parts = [
      `Tutarlılık: ${(evaluation.consistencyScore * 100).toFixed(0)}%`,
      `Kalite: ${(evaluation.qualityScore * 100).toFixed(0)}%`,
      `Misyon Uyumu: ${(evaluation.missionAlignment * 100).toFixed(0)}%`,
    ];

    if (retryCount != null) {
      parts.push(`Retry: ${retryCount}/3 tamamlandı`);
    }

    if (evaluation.feedback) {
      parts.push(`\nGeri bildirim: ${evaluation.feedback}`);
    }

    return parts.join('\n');
  }

  private generateOptions(evaluation: EvaluationResult): string[] {
    const options: string[] = [];

    options.push('Devam et — bu çıktıyı kabul et ve ilerle');
    options.push('Atla — bu task\'ı atla, sonrakine geç');

    const categories = new Set(evaluation.issues.map(i => i.category));

    if (categories.has('scope-creep')) {
      options.push('Kapsamı daralt — bu task\'ı küçült veya böl');
    }
    if (categories.has('architecture-violation')) {
      options.push('Mimariyi güncelle — ARCHITECTURE.md\'yi revize et');
    }

    options.push('Durdur — projeyi duraklat');

    return options;
  }

  private ask(prompt: string): Promise<string> {
    // Test injection
    if (this._askFn) {
      return this._askFn(prompt);
    }

    // Gerçek readline
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
