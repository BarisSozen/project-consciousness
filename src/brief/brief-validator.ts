/**
 * Brief Validator — Understand Before Building
 *
 * After brief is collected, validates completeness and asks
 * targeted follow-up questions until confidence is high enough.
 *
 * Checks for:
 * 1. Entity clarity — are the main data objects clear?
 * 2. Relationship clarity — how do entities relate?
 * 3. Auth clarity — who can do what?
 * 4. Business rules — are edge cases specified?
 * 5. Success criteria — how do we know it's done?
 *
 * Only proceeds to planning when confidence >= threshold.
 */

import { createInterface } from 'node:readline';
import { interactiveSelect } from '../orchestrator/interactive-selector.js';
import type { ArchitectureDecisions } from '../types/index.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ValidationResult {
  isComplete: boolean;
  confidence: number;       // 0-100
  gaps: ValidationGap[];
  enrichedBrief: string;    // Original brief + answers
}

export interface ValidationGap {
  category: 'entity' | 'relationship' | 'auth' | 'business-rule' | 'success-criteria' | 'scope';
  question: string;
  importance: 'critical' | 'important' | 'nice-to-have';
  options?: string[];
}

// ═══════════════════════════════════════════════════════════
// Gap Detection Rules
// ═══════════════════════════════════════════════════════════

interface GapRule {
  category: ValidationGap['category'];
  importance: ValidationGap['importance'];
  check: (brief: string, decisions?: ArchitectureDecisions) => string | null;
}

const GAP_RULES: GapRule[] = [
  // Entity clarity
  {
    category: 'entity',
    importance: 'critical',
    check: (brief) => {
      const entities = extractEntities(brief);
      if (entities.length === 0) {
        return 'Projenin ana veri nesneleri (entity) belirsiz. Hangi verileri yöneteceksin? (örn: User, Product, Order)';
      }
      return null;
    },
  },

  // Relationships
  {
    category: 'relationship',
    importance: 'important',
    check: (brief) => {
      const entities = extractEntities(brief);
      if (entities.length >= 2) {
        const b = brief.toLowerCase();
        const hasRelationKeywords = ['belongs to', 'has many', 'ilişki', 'relation', 'bağlı', 'sahip', 'owns', 'contains'].some(k => b.includes(k));
        if (!hasRelationKeywords) {
          return `${entities.join(', ')} arasındaki ilişki belirtilmemiş. Örnek: "Her User birden fazla Order'a sahip olabilir"`;
        }
      }
      return null;
    },
  },

  // Auth rules
  {
    category: 'auth',
    importance: 'important',
    check: (brief, decisions) => {
      if (decisions?.auth && decisions.auth !== 'none') {
        const b = brief.toLowerCase();
        const hasRoles = ['admin', 'role', 'permission', 'yetki', 'rol', 'izin', 'sadece', 'only'].some(k => b.includes(k));
        if (!hasRoles) {
          return 'Auth var ama yetkilendirme kuralları belirsiz. Kim ne yapabilir? (örn: "Sadece admin kullanıcı silebilir", "Herkes okuyabilir")';
        }
      }
      return null;
    },
  },

  // Business rules / edge cases
  {
    category: 'business-rule',
    importance: 'important',
    check: (brief) => {
      const b = brief.toLowerCase();
      // Check for vague terms that need clarification
      const vagueTerms = [
        { term: 'uygun', question: '"Uygun" ne demek? Hangi koşul sağlanınca uygun?' },
        { term: 'yeterli', question: '"Yeterli" ne demek? Hangi threshold/limit?' },
        { term: 'çok', question: '"Çok" ne kadar? Sayısal bir limit var mı?' },
        { term: 'hızlı', question: '"Hızlı" ne kadar? Hedef response time?' },
        { term: 'güvenli', question: 'Güvenlik gereksinimleri neler? (HTTPS, rate limit, input validation?)' },
      ];

      for (const { term, question } of vagueTerms) {
        if (b.includes(term)) return question;
      }
      return null;
    },
  },

  // Success criteria
  {
    category: 'success-criteria',
    importance: 'critical',
    check: (brief) => {
      const b = brief.toLowerCase();
      const hasCriteria = ['başarı', 'success', 'criteria', 'kriter', 'bitti', 'done', 'tamamland', 'kabul', 'accept'].some(k => b.includes(k));
      const hasEndpoints = ['endpoint', 'api', 'route', 'get', 'post', 'put', 'delete', 'crud'].some(k => b.includes(k));

      if (!hasCriteria && !hasEndpoints) {
        return 'Başarı kriterleri belirsiz. Proje ne zaman "bitti" sayılacak? (örn: "Kullanıcı kayıt olup giriş yapabilmeli", "CRUD API çalışmalı")';
      }
      return null;
    },
  },

  // Scope boundaries
  {
    category: 'scope',
    importance: 'nice-to-have',
    check: (brief) => {
      const b = brief.toLowerCase();
      const hasScope = ['scope', 'kapsam', 'dahil', 'hariç', 'include', 'exclude', 'olmadan', 'without', 'sadece', 'only'].some(k => b.includes(k));

      if (!hasScope && b.length < 100) {
        return 'Brief kısa — kapsam dışı bırakılması gereken şeyler var mı? (örn: "Email gönderimi yok", "Payment yok", "Admin panel yok")';
      }
      return null;
    },
  },
];

// ═══════════════════════════════════════════════════════════
// Validator
// ═══════════════════════════════════════════════════════════

export class BriefValidator {
  private confidenceThreshold: number;

  constructor(confidenceThreshold = 70) {
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Validate brief completeness and ask follow-up questions.
   * Returns enriched brief only when confidence >= threshold.
   */
  async validate(
    brief: string,
    decisions?: ArchitectureDecisions
  ): Promise<ValidationResult> {
    let currentBrief = brief;
    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations) {
      const gaps = this.detectGaps(currentBrief, decisions);
      const confidence = this.calculateConfidence(currentBrief, gaps);

      if (confidence >= this.confidenceThreshold || gaps.length === 0) {
        return {
          isComplete: true,
          confidence,
          gaps: [],
          enrichedBrief: currentBrief,
        };
      }

      // Ask the most important unanswered gap
      const criticalGaps = gaps.filter(g => g.importance === 'critical');
      const importantGaps = gaps.filter(g => g.importance === 'important');
      const nextGap = criticalGaps[0] ?? importantGaps[0] ?? gaps[0];

      if (!nextGap) break;

      console.log(`\n  💭 Confidence: ${confidence}% — need more clarity\n`);

      const answer = await this.askGap(nextGap);
      if (answer === '__skip__') {
        // User wants to skip — proceed with what we have
        return {
          isComplete: false,
          confidence,
          gaps,
          enrichedBrief: currentBrief,
        };
      }

      // Enrich brief with answer
      currentBrief += `\n\nEk bilgi (${nextGap.category}): ${answer}`;
      iteration++;
    }

    const finalGaps = this.detectGaps(currentBrief, decisions);
    const finalConfidence = this.calculateConfidence(currentBrief, finalGaps);

    return {
      isComplete: finalConfidence >= this.confidenceThreshold,
      confidence: finalConfidence,
      gaps: finalGaps,
      enrichedBrief: currentBrief,
    };
  }

  /**
   * Non-interactive validation — just detect gaps without asking.
   */
  detectGaps(brief: string, decisions?: ArchitectureDecisions): ValidationGap[] {
    const gaps: ValidationGap[] = [];

    for (const rule of GAP_RULES) {
      const question = rule.check(brief, decisions);
      if (question) {
        gaps.push({
          category: rule.category,
          question,
          importance: rule.importance,
        });
      }
    }

    return gaps;
  }

  /**
   * Calculate confidence score (0-100) based on brief completeness.
   */
  calculateConfidence(brief: string, gaps: ValidationGap[]): number {
    let score = 30; // base score for having a brief at all

    const b = brief.toLowerCase();

    // Entity detection (+20)
    const entities = extractEntities(brief);
    if (entities.length >= 1) score += 10;
    if (entities.length >= 2) score += 10;

    // Technical specificity (+15)
    if (['api', 'endpoint', 'route', 'crud', 'rest', 'graphql'].some(k => b.includes(k))) score += 10;
    if (['auth', 'login', 'jwt', 'session'].some(k => b.includes(k))) score += 5;

    // Success criteria (+15)
    if (['should', 'must', 'can', 'able', 'yapabilmeli', 'olmalı', 'gerekir'].some(k => b.includes(k))) score += 15;

    // Scope clarity (+10)
    if (b.length > 200) score += 5;
    if (['without', 'exclude', 'hariç', 'olmadan', 'sadece', 'only'].some(k => b.includes(k))) score += 5;

    // Relationship clarity (+10)
    if (['belongs', 'has many', 'relation', 'ilişki', 'bağlı'].some(k => b.includes(k))) score += 10;

    // Penalty for gaps
    const criticalPenalty = gaps.filter(g => g.importance === 'critical').length * 15;
    const importantPenalty = gaps.filter(g => g.importance === 'important').length * 5;

    return Math.max(0, Math.min(100, score - criticalPenalty - importantPenalty));
  }

  // ═══════════════════════════════════════════════════════════
  // Interactive Question Asking
  // ═══════════════════════════════════════════════════════════

  private async askGap(gap: ValidationGap): Promise<string> {
    const icon = gap.importance === 'critical' ? '🔴' : gap.importance === 'important' ? '🟡' : '🔵';

    if (gap.options && gap.options.length > 0) {
      const result = await interactiveSelect({
        title: gap.question,
        icon,
        options: [
          ...gap.options.map(o => ({ key: o, label: o })),
          { key: '__skip__', label: 'Atla — bu bilgi olmadan devam et' },
        ],
      });
      return result.key;
    }

    // Free text question
    console.log(`  ${icon} ${gap.question}`);
    console.log('  \x1b[2m(Atlamak için boş bırakın)\x1b[0m');

    return new Promise((resolve) => {
      if (!process.stdin.isTTY) {
        resolve('__skip__');
        return;
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('  > ', (answer) => {
        rl.close();
        const trimmed = answer.trim();
        resolve(trimmed || '__skip__');
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function extractEntities(text: string): string[] {
  const b = text.toLowerCase();
  const patterns = [
    /\b(user|kullanıcı|üye|member)\b/gi,
    /\b(product|ürün|item)\b/gi,
    /\b(order|sipariş|satın alma)\b/gi,
    /\b(todo|task|görev|iş)\b/gi,
    /\b(post|yazı|article|makale)\b/gi,
    /\b(comment|yorum)\b/gi,
    /\b(category|kategori)\b/gi,
    /\b(tag|etiket)\b/gi,
    /\b(project|proje)\b/gi,
    /\b(team|takım|ekip)\b/gi,
    /\b(message|mesaj)\b/gi,
    /\b(notification|bildirim)\b/gi,
    /\b(payment|ödeme)\b/gi,
    /\b(invoice|fatura)\b/gi,
    /\b(link|url|bağlantı)\b/gi,
  ];

  const found = new Set<string>();
  for (const pattern of patterns) {
    const matches = b.match(pattern);
    if (matches) {
      for (const m of matches) {
        found.add(m.toLowerCase());
      }
    }
  }
  return [...found];
}
