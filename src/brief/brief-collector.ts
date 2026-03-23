/**
 * Brief Collector — İnteraktif CLI ile SCOPE / ANTI-SCOPE Toplama
 * 
 * Kullanıcıdan yapılandırılmış sorularla brief toplar
 * ve MISSION.md'ye SCOPE / ANTI-SCOPE / SUCCESS CRITERIA yazar.
 *
 * Tasarım ilkesi #5: Human-Readable — tüm state markdown
 * Tasarım ilkesi #2: Fail-Safe — şüphe durumunda insana sor
 */

import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import type { Brief, BriefScope, BriefAntiScope, StackType } from '../types/index.js';

const STACK_OPTIONS: Record<string, StackType> = {
  '1': 'typescript-node',
  '2': 'react',
  '3': 'python',
  '4': 'go',
  '5': 'other',
};

export class BriefCollector {
  private rl: ReturnType<typeof createInterface> | null = null;

  /**
   * Interaktif CLI sorularıyla brief topla
   */
  async collect(): Promise<Brief> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n╔══════════════════════════════════════════════╗');
      console.log('║       PROJECT CONSCIOUSNESS — Brief           ║');
      console.log('╚══════════════════════════════════════════════╝\n');

      const scope = await this.collectScope();
      const antiScope = await this.collectAntiScope();

      return {
        scope,
        antiScope,
        collectedAt: new Date().toISOString(),
      };
    } finally {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Programmatic brief oluşturma (test / CI için)
   */
  static create(scope: BriefScope, antiScope: BriefAntiScope): Brief {
    return {
      scope,
      antiScope,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Brief'i MISSION.md'ye yaz.
   * Mevcut dosyanın sonuna SCOPE / ANTI-SCOPE ekler veya günceller.
   */
  async writeMission(brief: Brief, missionPath: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(missionPath, 'utf-8');
    } catch {
      content = '# MISSION\n';
    }

    // Mevcut SCOPE/ANTI-SCOPE bölümlerini kaldır
    content = this.stripBriefSections(content);

    // Yeni bölümleri ekle
    const briefSection = this.renderBrief(brief);
    const updated = content.trimEnd() + '\n\n' + briefSection + '\n';

    await writeFile(missionPath, updated, 'utf-8');
  }

  /**
   * MISSION.md'den anti-scope bilgisini parse et
   */
  static parseAntiScope(missionContent: string): BriefAntiScope {
    const antiScope: BriefAntiScope = {
      protectedFiles: [],
      lockedDecisions: [],
      forbiddenDeps: [],
      breakingChanges: [],
    };

    const section = extractSection(missionContent, '## ANTI-SCOPE');
    if (!section) return antiScope;

    antiScope.protectedFiles = extractListItems(section, 'Dokunulmaz dosyalar');
    antiScope.lockedDecisions = extractListItems(section, 'Kilitli kararlar');
    antiScope.forbiddenDeps = extractListItems(section, 'Yasaklı bağımlılıklar');
    antiScope.breakingChanges = extractListItems(section, 'Kabul edilemez kırılmalar');

    return antiScope;
  }

  /**
   * MISSION.md'den stack tipini parse et
   */
  static parseStackType(missionContent: string): StackType | null {
    const section = extractSection(missionContent, '## SCOPE');
    if (!section) return null;

    const stackLine = section.match(/\*\*Stack\*\*:\s*(.+)/i);
    if (!stackLine) return null;

    const raw = stackLine[1]!.toLowerCase();
    if (raw.includes('react')) return 'react';
    if (raw.includes('typescript') || raw.includes('node')) return 'typescript-node';
    if (raw.includes('python')) return 'python';
    if (raw.includes('go')) return 'go';
    return 'other';
  }

  // ── SCOPE Collection ────────────────────────────────────

  private async collectScope(): Promise<BriefScope> {
    console.log('━━━ SCOPE — Ne İnşa Ediyoruz? ━━━\n');

    const whatToBuild = await this.ask(
      '📋 Ne inşa edilecek? (Projeyi bir paragrafta anlat)\n> '
    );

    console.log('\n📦 Hangi stack?\n  1. TypeScript/Node.js\n  2. React\n  3. Python\n  4. Go\n  5. Diğer');
    const stackChoice = await this.ask('> ');
    const stack = STACK_OPTIONS[stackChoice.trim()] ?? 'other';
    let stackDetails: string | undefined;
    if (stack === 'other') {
      stackDetails = await this.ask('  Hangi teknoloji? > ');
    }

    console.log('\n🎯 Başarı nasıl görünür? (Her kriteri yeni satırda yaz, boş satır bitir)');
    const successCriteria = await this.askMultiline('> ');

    return { whatToBuild, stack, stackDetails, successCriteria };
  }

  // ── ANTI-SCOPE Collection ───────────────────────────────

  private async collectAntiScope(): Promise<BriefAntiScope> {
    console.log('\n━━━ ANTI-SCOPE — Neye Dokunulmasın? ━━━\n');

    console.log('🔒 Hangi dosyalara kesinlikle dokunulmasın? (her satıra bir dosya, boş satır bitir)');
    const protectedFiles = await this.askMultiline('> ');

    console.log('\n🔐 Hangi kararlar kilitli? Değiştirilmesin? (boş satır bitir)');
    const lockedDecisions = await this.askMultiline('> ');

    console.log('\n🚫 Hangi kütüphaneler/yaklaşımlar yasaklı? (boş satır bitir)');
    const forbiddenDeps = await this.askMultiline('> ');

    console.log('\n💥 Ne kırılırsa kabul edilemez? (boş satır bitir)');
    const breakingChanges = await this.askMultiline('> ');

    return { protectedFiles, lockedDecisions, forbiddenDeps, breakingChanges };
  }

  // ── Render ──────────────────────────────────────────────

  private renderBrief(brief: Brief): string {
    const { scope, antiScope } = brief;
    const stackLabel = this.stackLabel(scope.stack, scope.stackDetails);

    let md = `## SCOPE

**Ne inşa ediyoruz**: ${scope.whatToBuild}

**Stack**: ${stackLabel}

**Başarı Kriterleri**:
${scope.successCriteria.map(c => `- ${c}`).join('\n')}

## ANTI-SCOPE

**Dokunulmaz dosyalar**:
${antiScope.protectedFiles.length > 0 ? antiScope.protectedFiles.map(f => `- \`${f}\``).join('\n') : '- _(yok)_'}

**Kilitli kararlar**:
${antiScope.lockedDecisions.length > 0 ? antiScope.lockedDecisions.map(d => `- ${d}`).join('\n') : '- _(yok)_'}

**Yasaklı bağımlılıklar**:
${antiScope.forbiddenDeps.length > 0 ? antiScope.forbiddenDeps.map(d => `- \`${d}\``).join('\n') : '- _(yok)_'}

**Kabul edilemez kırılmalar**:
${antiScope.breakingChanges.length > 0 ? antiScope.breakingChanges.map(b => `- ${b}`).join('\n') : '- _(yok)_'}

## SUCCESS CRITERIA

${scope.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

> Brief toplama tarihi: ${brief.collectedAt}`;

    return md;
  }

  private stackLabel(stack: StackType, details?: string): string {
    switch (stack) {
      case 'typescript-node': return 'TypeScript + Node.js';
      case 'react': return 'React (TypeScript)';
      case 'python': return 'Python';
      case 'go': return 'Go';
      case 'other': return details ?? 'Diğer';
    }
  }

  private stripBriefSections(content: string): string {
    // ## SCOPE, ## ANTI-SCOPE, ## SUCCESS CRITERIA bölümlerini kaldır
    return content
      .replace(/\n## SCOPE[\s\S]*?(?=\n## [A-Z]|$)/, '')
      .replace(/\n## ANTI-SCOPE[\s\S]*?(?=\n## [A-Z]|$)/, '')
      .replace(/\n## SUCCESS CRITERIA[\s\S]*?(?=\n## [A-Z]|$)/, '');
  }

  // ── Readline Helpers ────────────────────────────────────

  private ask(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl!.question(prompt, (answer) => resolve(answer.trim()));
    });
  }

  private async askMultiline(prompt: string): Promise<string[]> {
    const lines: string[] = [];
    while (true) {
      const line = await this.ask(prompt);
      if (line === '') break;
      lines.push(line);
    }
    return lines;
  }
}

// ── Module-level Helpers ────────────────────────────────────

function extractSection(content: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  return match?.[1]?.trim() ?? null;
}

function extractListItems(section: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\*\\*${escaped}\\*\\*:\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)`);
  const match = section.match(regex);
  if (!match?.[1]) return [];

  return match[1]
    .split('\n')
    .filter(l => l.startsWith('- ') && !l.includes('_(yok)_'))
    .map(l => l.replace(/^- `?/, '').replace(/`?$/, '').trim());
}
