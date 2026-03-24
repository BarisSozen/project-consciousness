/**
 * Smart Brief — Tek Soru → Analiz → Ürün Soruları → Otomatik Kararlar
 *
 * 5 adımlı akış:
 * 1. "Ne yapmak istiyorsun?" — serbest metin
 * 2. Brief analizi — teknik kararları otomatik al, belirsizlikleri tespit et
 * 3. Sadece belirsiz ürün soruları sor (max 3-4, hepsi opsiyonel)
 * 4. Anti-scope otomatik çıkar
 * 5. Özet göster, onay al
 *
 * D012: SCOPE / ANTI-SCOPE yapısı (backward compatible)
 * D020: ArchitectAgent kararları (artık otomatik)
 */

import type {
  SmartBriefResult,
  BriefAnalysis,
  ClarificationQuestion,
  ClarificationAnswer,
  ArchitectureDecisions,
  AuthStrategy,
  DatabaseChoice,
  ApiStyle,
  FrontendChoice,
  DeployTarget,
  BriefScope,
  BriefAntiScope,
  StackType,
} from '../types/index.js';

// ── Brief Analysis Patterns ─────────────────────────────────

interface TechPattern {
  keywords: string[];
  key: keyof ArchitectureDecisions;
  value: string;
  reason: string;
}

const TECH_PATTERNS: TechPattern[] = [
  // Auth
  { keywords: ['kayıt', 'register', 'signup', 'giriş', 'login', 'auth', 'kullanıcı', 'user', 'oturum'], key: 'auth', value: 'jwt', reason: 'Kullanıcı kaydı/girişi gerekiyor' },
  { keywords: ['api key', 'api-key', 'token based'], key: 'auth', value: 'api-key', reason: 'API key tabanlı erişim' },
  { keywords: ['oauth', 'google login', 'github login', 'social login'], key: 'auth', value: 'oauth', reason: 'Social login gerekiyor' },

  // Database
  { keywords: ['postgresql', 'postgres', 'büyük veri', 'production db'], key: 'database', value: 'postgresql', reason: 'Production-grade DB' },
  { keywords: ['mongodb', 'nosql', 'document db'], key: 'database', value: 'mongodb', reason: 'NoSQL gerekiyor' },
  { keywords: ['sqlite', 'hafif db', 'local db', 'basit'], key: 'database', value: 'sqlite', reason: 'Hafif, dosya tabanlı DB' },
  { keywords: ['in-memory', 'bellekte', 'db yok'], key: 'database', value: 'in-memory', reason: 'DB gereksiz' },

  // API Style
  { keywords: ['graphql', 'query language'], key: 'apiStyle', value: 'graphql', reason: 'GraphQL API' },
  { keywords: ['trpc', 'type-safe rpc'], key: 'apiStyle', value: 'trpc', reason: 'tRPC' },
  { keywords: ['rest', 'api', 'endpoint', 'crud'], key: 'apiStyle', value: 'rest', reason: 'REST API' },

  // Frontend
  { keywords: ['react', 'jsx', 'component'], key: 'frontend', value: 'react', reason: 'React frontend' },
  { keywords: ['vue', 'vuejs'], key: 'frontend', value: 'vue', reason: 'Vue frontend' },
  { keywords: ['next', 'nextjs', 'next.js', 'ssr'], key: 'frontend', value: 'nextjs', reason: 'Next.js' },
  { keywords: ['api only', 'sadece api', 'backend', 'api-only', 'frontend yok'], key: 'frontend', value: 'api-only', reason: 'Sadece backend' },

  // Deploy
  { keywords: ['docker', 'container'], key: 'deployment', value: 'docker', reason: 'Docker deployment' },
  { keywords: ['vercel', 'aws', 'gcp', 'cloud', 'deploy'], key: 'deployment', value: 'cloud', reason: 'Cloud deployment' },
];

// ── Product Question Generators ─────────────────────────────

interface QuestionGenerator {
  trigger: string[];
  generate: (brief: string) => ClarificationQuestion[];
}

const QUESTION_GENERATORS: QuestionGenerator[] = [
  {
    trigger: ['link', 'url', 'shortener', 'kısalt', 'redirect'],
    generate: () => [
      {
        id: 'link-access',
        question: 'Kısaltılmış linkler herkese açık mı, sadece giriş yapanlara mı?',
        options: ['Herkese açık', 'Sadece giriş yapanlar', 'İkisi de (seçilebilir)'],
        defaultAnswer: 'Herkese açık',
        category: 'access' as const,
      },
      {
        id: 'link-expiry',
        question: 'Linkler süresi dolar mı?',
        options: ['Süresiz', 'Opsiyonel süre limiti', 'Her zaman süreli'],
        defaultAnswer: 'Süresiz',
        category: 'lifecycle' as const,
      },
    ],
  },
  {
    trigger: ['kullanıcı', 'user', 'kayıt', 'register', 'profil', 'account'],
    generate: () => [
      {
        id: 'user-visibility',
        question: 'Kullanıcılar birbirinin içeriklerini görebilir mi?',
        options: ['Evet, herkes görür', 'Hayır, sadece kendi', 'Opsiyonel paylaşım'],
        defaultAnswer: 'Hayır, sadece kendi',
        category: 'visibility' as const,
      },
    ],
  },
  {
    trigger: ['ödeme', 'payment', 'premium', 'plan', 'abonelik', 'subscription', 'ücret', 'para'],
    generate: () => [
      {
        id: 'monetization',
        question: 'Ödeme/abonelik sistemi olacak mı?',
        options: ['Hayır, tamamen ücretsiz', 'Evet, premium plan', 'İleride eklenebilir'],
        defaultAnswer: 'Hayır, tamamen ücretsiz',
        category: 'monetization' as const,
      },
    ],
  },
  {
    trigger: ['api', 'endpoint', 'backend', 'server'],
    generate: (brief: string) => {
      const hasFrontendHint = /react|vue|next|frontend|sayfa|page|ui|arayüz/i.test(brief);
      if (hasFrontendHint) return [];
      return [
        {
          id: 'api-scope',
          question: 'Sadece API mı yoksa frontend de olacak mı?',
          options: ['Sadece API', 'API + basit frontend', 'Full-stack uygulama'],
          defaultAnswer: 'Sadece API',
          category: 'scope' as const,
        },
      ];
    },
  },
  {
    trigger: ['dosya', 'file', 'upload', 'yükle', 'resim', 'image', 'media'],
    generate: () => [
      {
        id: 'file-storage',
        question: 'Dosya yükleme nereye yapılacak?',
        options: ['Local disk', 'S3/Cloud storage', 'Dosya yükleme yok'],
        defaultAnswer: 'Dosya yükleme yok',
        category: 'scope' as const,
      },
    ],
  },
];

// ── Stack Detection ─────────────────────────────────────────

function detectStack(brief: string): StackType {
  const lower = brief.toLowerCase();
  if (/react|jsx|next\.?js/.test(lower)) return 'react';
  if (/python|django|flask|fastapi/.test(lower)) return 'python';
  if (/\bgo\b|golang|gin|fiber/.test(lower)) return 'go';
  // Default: TypeScript/Node
  return 'typescript-node';
}

// ── SmartBrief Class ────────────────────────────────────────

export class SmartBrief {
  private _askFn: ((prompt: string) => Promise<string>) | null = null;

  /** Test injection */
  setAskFn(fn: (prompt: string) => Promise<string>): void {
    this._askFn = fn;
  }

  /**
   * ADIM 1: Kullanıcıdan serbest metin al
   */
  async askBrief(askFn?: (prompt: string) => Promise<string>): Promise<string> {
    const fn = this._askFn ?? askFn;
    if (!fn) throw new Error('askFn required for interactive mode');

    return fn('📋 Ne yapmak istiyorsun?\n> ');
  }

  /**
   * ADIM 2: Brief'i analiz et — teknik kararları otomatik al, belirsizlikleri bul
   */
  analyzeBrief(rawInput: string): BriefAnalysis {
    const lower = rawInput.toLowerCase();

    // Teknik kararları otomatik çıkar
    const autoDecisions: BriefAnalysis['autoDecisions'] = [];
    const decided = new Set<string>();

    for (const pattern of TECH_PATTERNS) {
      if (decided.has(pattern.key)) continue;
      const match = pattern.keywords.some(kw => lower.includes(kw));
      if (match) {
        autoDecisions.push({
          key: pattern.key,
          value: pattern.value,
          reason: pattern.reason,
        });
        decided.add(pattern.key);
      }
    }

    // Default'ları ekle (karar verilmeyenler için)
    if (!decided.has('auth')) {
      // Auth gerekiyor mu anlamaya çalış
      const needsAuth = /kayıt|register|login|giriş|kullanıcı|user|auth|oturum/i.test(rawInput);
      autoDecisions.push({
        key: 'auth',
        value: needsAuth ? 'jwt' : 'none',
        reason: needsAuth ? 'Kullanıcı yönetimi gerekiyor' : 'Auth gerekmiyor',
      });
      decided.add('auth');
    }
    if (!decided.has('database')) {
      autoDecisions.push({ key: 'database', value: 'sqlite', reason: 'Default: hafif SQLite' });
      decided.add('database');
    }
    if (!decided.has('apiStyle')) {
      autoDecisions.push({ key: 'apiStyle', value: 'rest', reason: 'Default: REST API' });
      decided.add('apiStyle');
    }
    if (!decided.has('frontend')) {
      autoDecisions.push({ key: 'frontend', value: 'api-only', reason: 'Default: sadece API' });
      decided.add('frontend');
    }
    if (!decided.has('deployment')) {
      autoDecisions.push({ key: 'deployment', value: 'local', reason: 'Default: local' });
      decided.add('deployment');
    }

    // Belirsiz ürün soruları
    const questions: ClarificationQuestion[] = [];
    const questionIds = new Set<string>();

    for (const gen of QUESTION_GENERATORS) {
      const triggered = gen.trigger.some(t => lower.includes(t));
      if (triggered) {
        const newQuestions = gen.generate(rawInput);
        for (const q of newQuestions) {
          if (!questionIds.has(q.id)) {
            questions.push(q);
            questionIds.add(q.id);
          }
        }
      }
    }

    // Max 4 soru
    const limitedQuestions = questions.slice(0, 4);

    // Başarı kriterlerini brief'ten çıkar
    const inferredCriteria = this.inferCriteria(rawInput, autoDecisions);

    return {
      autoDecisions,
      uncertainQuestions: limitedQuestions,
      inferredCriteria,
    };
  }

  /**
   * ADIM 3: Sadece belirsiz ürün soruları sor (opsiyonel — enter ile geç)
   */
  async askClarifications(
    questions: ClarificationQuestion[],
    askFn?: (prompt: string) => Promise<string>
  ): Promise<ClarificationAnswer[]> {
    const fn = this._askFn ?? askFn;
    if (!fn) return questions.map(q => ({ questionId: q.id, answer: q.defaultAnswer }));

    if (questions.length === 0) return [];

    const answers: ClarificationAnswer[] = [];

    for (const q of questions) {
      const optionList = q.options
        .map((o, i) => `  ${i + 1}. ${o}`)
        .join('\n');

      const answer = await fn(
        `\n❓ ${q.question}\n${optionList}\n   (Enter = ${q.defaultAnswer})\n> `
      );

      const trimmed = answer.trim();
      if (trimmed === '') {
        answers.push({ questionId: q.id, answer: q.defaultAnswer });
      } else {
        const num = parseInt(trimmed, 10);
        const selected = (num >= 1 && num <= q.options.length)
          ? q.options[num - 1]!
          : trimmed; // freeform cevap
        answers.push({ questionId: q.id, answer: selected });
      }
    }

    return answers;
  }

  /**
   * ADIM 4: Anti-scope otomatik çıkar
   */
  buildAntiScope(
    rawInput: string,
    analysis: BriefAnalysis,
    answers: ClarificationAnswer[]
  ): BriefAntiScope {
    const protectedFiles = ['MISSION.md'];
    const forbiddenDeps: string[] = [];
    const lockedDecisions: string[] = [];
    const breakingChanges = ['Mevcut testler kırılmasın'];

    // Cevaplardan anti-scope çıkar
    for (const a of answers) {
      const ansLower = a.answer.toLowerCase();

      if (a.questionId === 'monetization') {
        if (ansLower.includes('hayır') || ansLower.includes('ücretsiz')) {
          forbiddenDeps.push('stripe', 'paddle', 'lemonsqueezy');
          lockedDecisions.push('Ödeme sistemi yok');
        }
      }

      if (a.questionId === 'api-scope') {
        if (ansLower.includes('sadece api') || ansLower === 'sadece api') {
          forbiddenDeps.push('react', 'vue', 'svelte', 'next');
          lockedDecisions.push('Frontend yok, sadece API');
        }
      }

      if (a.questionId === 'file-storage') {
        if (ansLower.includes('yok')) {
          forbiddenDeps.push('multer', 'formidable');
          lockedDecisions.push('Dosya yükleme yok');
        }
      }
    }

    // Brief'ten çıkar — açıkça bahsedilmeyen yasaklar
    const lower = rawInput.toLowerCase();
    if (!lower.includes('frontend') && !lower.includes('react') && !lower.includes('vue') && !lower.includes('next')) {
      const frontendDecision = analysis.autoDecisions.find(d => d.key === 'frontend');
      if (frontendDecision?.value === 'api-only') {
        if (!forbiddenDeps.includes('react')) {
          forbiddenDeps.push('react', 'vue', 'svelte');
        }
      }
    }

    return {
      protectedFiles,
      lockedDecisions,
      forbiddenDeps: [...new Set(forbiddenDeps)],
      breakingChanges,
    };
  }

  /**
   * ADIM 5: Özet oluştur (onay için)
   */
  buildSummary(
    decisions: ArchitectureDecisions,
    antiScope: BriefAntiScope,
    criteria: string[]
  ): string {
    const lines: string[] = [];
    lines.push('╔══════════════════════════════════════════════╗');
    lines.push('║         Plan Özeti                            ║');
    lines.push('╚══════════════════════════════════════════════╝');
    lines.push('');

    // Yapılacaklar
    const decisionLabels: Record<string, Record<string, string>> = {
      auth: { jwt: '🔐 JWT Auth', session: '🔐 Session Auth', oauth: '🔐 OAuth', 'api-key': '🔑 API Key', none: '' },
      database: { postgresql: '🗄️ PostgreSQL', mongodb: '🗄️ MongoDB', sqlite: '🗄️ SQLite', 'in-memory': '🗄️ In-memory' },
      apiStyle: { rest: '🌐 REST API', graphql: '🌐 GraphQL', trpc: '🌐 tRPC' },
      frontend: { react: '🖥️ React', vue: '🖥️ Vue', nextjs: '🖥️ Next.js', 'api-only': '' },
      deployment: { local: '📦 Local', docker: '🐳 Docker', cloud: '☁️ Cloud' },
    };

    for (const [key, value] of Object.entries(decisions)) {
      if (key === 'extras') continue;
      const label = decisionLabels[key]?.[value as string];
      if (label) {
        lines.push(` ✅ ${label}`);
      }
    }

    // Yapılmayacaklar
    if (decisions.auth === 'none') lines.push(' ❌ Auth yok');
    if (decisions.frontend === 'api-only') lines.push(' ❌ Frontend yok');
    for (const locked of antiScope.lockedDecisions) {
      if (!locked.includes('yok')) continue;
      lines.push(` ❌ ${locked}`);
    }

    lines.push('');
    lines.push('📋 Başarı Kriterleri:');
    for (const c of criteria) {
      lines.push(`   • ${c}`);
    }

    return lines.join('\n');
  }

  /**
   * Tam akış: 5 adım birden — interaktif veya programmatic
   */
  async run(askFn?: (prompt: string) => Promise<string>): Promise<SmartBriefResult> {
    const fn = this._askFn ?? askFn;

    // ADIM 1: Brief al
    const rawInput = await this.askBrief(fn);

    // ADIM 2: Analiz et
    const analysis = this.analyzeBrief(rawInput);

    // ADIM 3: Belirsiz soruları sor
    const answers = await this.askClarifications(analysis.uncertainQuestions, fn);

    // ADIM 4: Kararları ve anti-scope'u oluştur
    const decisions = this.buildDecisions(analysis, answers);
    const antiScope = this.buildAntiScope(rawInput, analysis, answers);
    const stack = detectStack(rawInput);

    const scope: BriefScope = {
      whatToBuild: rawInput,
      stack,
      successCriteria: analysis.inferredCriteria,
    };

    // ADIM 5: Özet oluştur (caller loglayabilir)
    this.buildSummary(decisions, antiScope, analysis.inferredCriteria);

    return {
      rawInput,
      analysis,
      clarifications: answers,
      decisions,
      scope,
      antiScope,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Programmatic — test / CI için (soru sormadan analiz + karar)
   */
  runNonInteractive(rawInput: string, answers: ClarificationAnswer[] = []): SmartBriefResult {
    const analysis = this.analyzeBrief(rawInput);

    // Cevap verilmeyen sorular için default
    const allAnswers = analysis.uncertainQuestions.map(q => {
      const given = answers.find(a => a.questionId === q.id);
      return given ?? { questionId: q.id, answer: q.defaultAnswer };
    });

    const decisions = this.buildDecisions(analysis, allAnswers);
    const antiScope = this.buildAntiScope(rawInput, analysis, allAnswers);
    const stack = detectStack(rawInput);

    return {
      rawInput,
      analysis,
      clarifications: allAnswers,
      decisions,
      scope: {
        whatToBuild: rawInput,
        stack,
        successCriteria: analysis.inferredCriteria,
      },
      antiScope,
      collectedAt: new Date().toISOString(),
    };
  }

  // ── Private ─────────────────────────────────────────────

  /** Analysis'ten ArchitectureDecisions oluştur */
  private buildDecisions(
    analysis: BriefAnalysis,
    _answers: ClarificationAnswer[]
  ): ArchitectureDecisions {
    const decisions: Record<string, string> = {};

    for (const d of analysis.autoDecisions) {
      decisions[d.key] = d.value;
    }

    // Cevaplardan override (api-scope sorusu frontend kararını etkiler)
    for (const a of _answers) {
      const ansLower = a.answer.toLowerCase();
      if (a.questionId === 'api-scope') {
        if (ansLower.includes('full-stack') || ansLower.includes('full stack')) {
          decisions['frontend'] = 'react';
        } else if (ansLower.includes('basit frontend')) {
          decisions['frontend'] = 'react';
        }
      }
    }

    return {
      auth: (decisions['auth'] ?? 'none') as AuthStrategy,
      database: (decisions['database'] ?? 'sqlite') as DatabaseChoice,
      apiStyle: (decisions['apiStyle'] ?? 'rest') as ApiStyle,
      frontend: (decisions['frontend'] ?? 'api-only') as FrontendChoice,
      deployment: (decisions['deployment'] ?? 'local') as DeployTarget,
    };
  }

  /** Brief'ten başarı kriterlerini çıkar */
  private inferCriteria(
    rawInput: string,
    autoDecisions: BriefAnalysis['autoDecisions']
  ): string[] {
    const criteria: string[] = [];

    // Her zaman
    criteria.push('npm test geçmeli');
    criteria.push('TypeScript strict, 0 error');

    // Brief'teki fiilleri kriter yap
    const actionPhrases = rawInput.match(/([^,.]+(?:olsun|çalışsın|yapılsın|redirect|kısalt|kayıt|login|giriş|listele|sil|ekle|göster)(?:[^,.]*)?)/gi);
    if (actionPhrases) {
      for (const phrase of actionPhrases.slice(0, 5)) {
        const clean = phrase.trim();
        if (clean.length > 5 && clean.length < 100) {
          criteria.push(clean);
        }
      }
    }

    // Teknik kararlardan çıkar
    const authDecision = autoDecisions.find(d => d.key === 'auth');
    if (authDecision && authDecision.value !== 'none') {
      criteria.push('Auth endpoint çalışmalı');
    }

    return [...new Set(criteria)];
  }
}
