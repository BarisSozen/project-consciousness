/**
 * Orchestrator — Escalator
 * 
 * İnsan müdahalesi gereken durumları yönetir.
 * Eskalasyon kararı verir, formatlar, yanıt bekler.
 */

import type { 
  EscalationRequest, 
  EvaluationResult 
} from '../types/index.js';

export class Escalator {
  /**
   * Değerlendirme sonucuna göre eskalasyon gerekip gerekmediğine karar verir
   */
  shouldEscalate(evaluation: EvaluationResult): boolean {
    return evaluation.verdict === 'escalate';
  }

  /**
   * Eskalasyon request'i oluşturur
   */
  createEscalation(evaluation: EvaluationResult): EscalationRequest {
    const criticalIssues = evaluation.issues.filter(i => i.severity === 'critical');
    const hasScoreDrop = Math.min(
      evaluation.consistencyScore,
      evaluation.qualityScore,
      evaluation.missionAlignment
    ) < 0.4;

    return {
      taskId: evaluation.taskId,
      reason: this.formatReason(evaluation),
      context: this.formatContext(evaluation),
      options: this.generateOptions(evaluation),
      urgency: criticalIssues.length > 0 ? 'blocking' : 
               hasScoreDrop ? 'important' : 'informational',
    };
  }

  /**
   * Eskalasyonu insan tarafından okunabilir formatta render eder
   */
  formatForHuman(escalation: EscalationRequest): string {
    const urgencyEmoji = {
      blocking: '🚨',
      important: '⚠️',
      informational: 'ℹ️',
    };

    return `
${urgencyEmoji[escalation.urgency]} ESKALASYON — Task: ${escalation.taskId}
${'═'.repeat(50)}

📋 Sebep: ${escalation.reason}

📝 Bağlam:
${escalation.context}

🔀 Seçenekler:
${escalation.options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n')}

Yanıtınızı bekliyorum (numara veya açıklama)...
`;
  }

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

  private formatContext(evaluation: EvaluationResult): string {
    return [
      `Tutarlılık: ${(evaluation.consistencyScore * 100).toFixed(0)}%`,
      `Kalite: ${(evaluation.qualityScore * 100).toFixed(0)}%`,
      `Misyon Uyumu: ${(evaluation.missionAlignment * 100).toFixed(0)}%`,
      evaluation.feedback ? `\nGeri bildirim: ${evaluation.feedback}` : '',
    ].filter(Boolean).join('\n');
  }

  private generateOptions(evaluation: EvaluationResult): string[] {
    const options: string[] = [];

    // Her zaman mevcut seçenekler
    options.push('Devam et — bu çıktıyı kabul et ve ilerle');
    options.push('Revize et — agent\'a geri bildirimle tekrar gönder');

    // Sorun türüne göre ek seçenekler
    const categories = new Set(evaluation.issues.map(i => i.category));

    if (categories.has('scope-creep')) {
      options.push('Kapsamı daralt — bu task\'ı küçült veya böl');
    }
    if (categories.has('architecture-violation')) {
      options.push('Mimariyi güncelle — ARCHITECTURE.md\'yi revize et');
    }
    if (categories.has('mission-drift')) {
      options.push('Misyonu hatırlat — agent\'a MISSION.md\'yi yeniden oku');
    }

    options.push('Durdur — projeyi duraklat, sonra devam ederiz');

    return options;
  }
}
