/**
 * Architect Agent — Kodlamaya Başlamadan Önce Mimari Kararlar
 * 
 * Brief geldikten sonra kullanıcıya mimari sorular sorar.
 * Cevapları ARCHITECTURE.md'ye yazar.
 * Sonraki agent'lar bu kararları okur, tekrar sormaz.
 *
 * Tasarım ilkesi #1: Memory-First — her karar hafızada iz bırakır
 */

import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { interactiveSelect, inferRecommendations } from '../orchestrator/interactive-selector.js';
import type { SelectQuestion } from '../orchestrator/interactive-selector.js';
import type { ArchitectureDecisions, AuthStrategy, DatabaseChoice, ApiStyle, FrontendChoice, DeployTarget } from '../types/index.js';

const QUESTIONS: Array<{
  key: keyof ArchitectureDecisions;
  question: string;
  icon: string;
  options: Array<{ key: string; label: string; description?: string }>;
}> = [
  {
    key: 'auth',
    question: 'Auth stratejisi',
    icon: '🔐',
    options: [
      { key: 'jwt', label: 'JWT', description: 'Stateless tokens — scalable, API-friendly' },
      { key: 'session', label: 'Session', description: 'Server-side sessions — simple, stateful' },
      { key: 'oauth', label: 'OAuth', description: 'Google/GitHub login — user-friendly' },
      { key: 'api-key', label: 'API Key', description: 'Simple key auth — for service-to-service' },
      { key: 'none', label: 'No Auth', description: 'Public API — no authentication' },
    ],
  },
  {
    key: 'database',
    question: 'Database',
    icon: '🗄️',
    options: [
      { key: 'postgresql', label: 'PostgreSQL', description: 'Production-ready relational DB' },
      { key: 'mongodb', label: 'MongoDB', description: 'Document-based — flexible schema' },
      { key: 'sqlite', label: 'SQLite', description: 'File-based — zero setup, great for prototypes' },
      { key: 'in-memory', label: 'In-memory', description: 'No database — data resets on restart' },
    ],
  },
  {
    key: 'apiStyle',
    question: 'API stili',
    icon: '🌐',
    options: [
      { key: 'rest', label: 'REST', description: 'Standard HTTP endpoints — universal' },
      { key: 'graphql', label: 'GraphQL', description: 'Query language — flexible, typed' },
      { key: 'trpc', label: 'tRPC', description: 'End-to-end type-safe — TypeScript native' },
    ],
  },
  {
    key: 'frontend',
    question: 'Frontend',
    icon: '🖥️',
    options: [
      { key: 'api-only', label: 'API Only', description: 'No frontend — backend service only' },
      { key: 'react', label: 'React', description: 'SPA with React — rich client-side' },
      { key: 'nextjs', label: 'Next.js', description: 'Full-stack React with SSR/SSG' },
      { key: 'vue', label: 'Vue', description: 'Progressive framework — easy to learn' },
    ],
  },
  {
    key: 'deployment',
    question: 'Deployment',
    icon: '🚀',
    options: [
      { key: 'docker', label: 'Docker', description: 'Containerized — portable, reproducible' },
      { key: 'local', label: 'Local only', description: 'Development setup — no deploy config' },
      { key: 'cloud', label: 'Cloud', description: 'AWS/GCP/Vercel — production hosting' },
    ],
  },
];

export class ArchitectAgent {
  private _askFn: ((prompt: string) => Promise<string>) | null = null;

  /** Test injection */
  setAskFn(fn: (prompt: string) => Promise<string>): void {
    this._askFn = fn;
  }

  /**
   * İnteraktif CLI ile kullanıcıdan mimari kararları topla.
   * Arrow-key selection with smart defaults inferred from brief.
   */
  async runInteractive(brief?: string): Promise<ArchitectureDecisions> {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ARCHITECT — Mimari Kararlar                 ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // Infer smart defaults from brief
    const recommendations = brief ? inferRecommendations(brief) : new Map<string, string>();

    if (recommendations.size > 0) {
      console.log('  \x1b[2m💡 Brief\'ten öneriler çıkarıldı (★ ile işaretli)\x1b[0m\n');
    }

    // Use interactive arrow-key selector if TTY, else fallback to readline
    if (process.stdin.isTTY) {
      return this.collectWithSelector(recommendations);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const askFn = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    try {
      return await this.collectAnswers(askFn);
    } finally {
      rl.close();
    }
  }

  /**
   * Test/CI için direkt cevap ver
   */
  runWithDefaults(answers: ArchitectureDecisions): ArchitectureDecisions {
    return { ...answers };
  }

  /**
   * Kararları ARCHITECTURE.md'ye yaz
   */
  async writeToArchitecture(decisions: ArchitectureDecisions, archPath: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(archPath, 'utf-8');
    } catch {
      content = '# ARCHITECTURE\n';
    }

    // Mevcut "## Kararlar" bölümünü kaldır
    content = content.replace(/\n## Kararlar[\s\S]*?(?=\n## [A-Z]|$)/, '');

    const section = this.renderDecisions(decisions);
    const updated = content.trimEnd() + '\n\n' + section + '\n';

    await writeFile(archPath, updated, 'utf-8');
  }

  /**
   * ARCHITECTURE.md'den kararları parse et
   */
  static parseDecisions(content: string): ArchitectureDecisions | null {
    const section = content.match(/## Kararlar\s*\n([\s\S]*?)(?=\n## [A-Z]|$)/);
    if (!section?.[1]) return null;

    const get = (label: string): string | undefined => {
      const match = section[1]!.match(new RegExp(`\\*\\*${label}\\*\\*:\\s*(.+)`));
      return match?.[1]?.trim().split(' ')[0]?.toLowerCase();
    };

    return {
      auth: (get('Auth') ?? 'none') as AuthStrategy,
      database: (get('Database') ?? 'in-memory') as DatabaseChoice,
      apiStyle: (get('API') ?? 'rest') as ApiStyle,
      frontend: (get('Frontend') ?? 'api-only') as FrontendChoice,
      deployment: (get('Deployment') ?? 'local') as DeployTarget,
    };
  }

  // ── Private ─────────────────────────────────────────────

  private async collectWithSelector(
    recommendations: Map<string, string>
  ): Promise<ArchitectureDecisions> {
    const result: Record<string, string> = {};

    for (const q of QUESTIONS) {
      const recKey = recommendations.get(q.key);
      const selectQuestion: SelectQuestion = {
        title: q.question,
        icon: q.icon,
        options: q.options.map(o => ({
          ...o,
          recommended: o.key === recKey,
        })),
        allowOther: true,
      };

      const answer = await interactiveSelect(selectQuestion);
      result[q.key] = answer.key;
    }

    return result as unknown as ArchitectureDecisions;
  }

  private async collectAnswers(
    askFn: (prompt: string) => Promise<string>
  ): Promise<ArchitectureDecisions> {
    const fn = this._askFn ?? askFn;
    const result: Record<string, string> = {};

    for (const q of QUESTIONS) {
      const optionList = q.options
        .map((o, i) => `  ${i + 1}. ${o.label}`)
        .join('\n');

      const answer = await fn(`${q.question}\n${optionList}\n> `);
      const num = parseInt(answer.trim(), 10);
      const selected = (num >= 1 && num <= q.options.length)
        ? q.options[num - 1]!.key
        : q.options[0]!.key; // default: ilk seçenek

      result[q.key] = selected;
    }

    return result as unknown as ArchitectureDecisions;
  }

  private renderDecisions(d: ArchitectureDecisions): string {
    return `## Kararlar

**Auth**: ${d.auth}
**Database**: ${d.database}
**API**: ${d.apiStyle}
**Frontend**: ${d.frontend}
**Deployment**: ${d.deployment}
${d.extras ? Object.entries(d.extras).map(([k, v]) => `**${k}**: ${v}`).join('\n') : ''}
> Karar tarihi: ${new Date().toISOString()}`;
  }
}
