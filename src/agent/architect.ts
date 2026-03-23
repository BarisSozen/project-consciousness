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
import type { ArchitectureDecisions, AuthStrategy, DatabaseChoice, ApiStyle, FrontendChoice, DeployTarget } from '../types/index.js';

const QUESTIONS: Array<{
  key: keyof ArchitectureDecisions;
  question: string;
  options: Array<{ key: string; label: string }>;
}> = [
  {
    key: 'auth',
    question: '🔐 Auth stratejisi?',
    options: [
      { key: 'jwt', label: 'JWT (stateless tokens)' },
      { key: 'session', label: 'Session (server-side)' },
      { key: 'oauth', label: 'OAuth (Google/GitHub)' },
      { key: 'api-key', label: 'API Key (simple)' },
      { key: 'none', label: 'Auth yok' },
    ],
  },
  {
    key: 'database',
    question: '🗄️  Database?',
    options: [
      { key: 'postgresql', label: 'PostgreSQL' },
      { key: 'mongodb', label: 'MongoDB' },
      { key: 'sqlite', label: 'SQLite' },
      { key: 'in-memory', label: 'In-memory (DB yok)' },
    ],
  },
  {
    key: 'apiStyle',
    question: '🌐 API stili?',
    options: [
      { key: 'rest', label: 'REST' },
      { key: 'graphql', label: 'GraphQL' },
      { key: 'trpc', label: 'tRPC' },
    ],
  },
  {
    key: 'frontend',
    question: '🖥️  Frontend?',
    options: [
      { key: 'react', label: 'React' },
      { key: 'vue', label: 'Vue' },
      { key: 'nextjs', label: 'Next.js' },
      { key: 'api-only', label: 'Sadece API (frontend yok)' },
    ],
  },
  {
    key: 'deployment',
    question: '🚀 Deployment hedefi?',
    options: [
      { key: 'local', label: 'Local development' },
      { key: 'docker', label: 'Docker / Docker Compose' },
      { key: 'cloud', label: 'Cloud (AWS/GCP/Vercel)' },
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
   * İnteraktif CLI ile kullanıcıdan mimari kararları topla
   */
  async runInteractive(): Promise<ArchitectureDecisions> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const askFn = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ARCHITECT — Mimari Kararlar                 ║');
    console.log('╚══════════════════════════════════════════════╝\n');

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
