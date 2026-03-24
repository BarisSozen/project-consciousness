/**
 * Aim Collector — Tümdengelim (Top-Down) Amaç Ağacı
 *
 * Kullanıcıdan interaktif olarak amaç hiyerarşisi toplar:
 *   Ana Amaç → Alt Amaçlar → Leaf Amaçlar
 *
 * Her seviyede sorulan soru: "Bu amaca ulaşmak için ne doğru olmalı?"
 * Max 3 seviye derinlik — daha fazlası over-engineering.
 *
 * LLM gerektirmez.
 */

import { createInterface } from 'node:readline';
import type { AimNode } from '../types/index.js';

const MAX_DEPTH = 3;

export class AimCollector {
  private rl: ReturnType<typeof createInterface> | null = null;

  /**
   * Interaktif olarak amaç ağacı topla
   */
  async collect(): Promise<AimNode> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n  ━━━ AIM TREE — Tümdengelim Planlama ━━━\n');
      console.log('  En geniş hedeften en küçük adıma doğru ineceğiz.\n');

      const mainAim = await this.ask('  🎯 Ana amaç nedir? (Projenin nihai hedefi)\n  > ');

      const root: AimNode = {
        id: 'A1',
        aim: mainAim.trim(),
        children: [],
        linkedTasks: [],
        priority: 'critical',
      };

      await this.collectChildren(root, 1);

      return root;
    } finally {
      this.rl!.close();
      this.rl = null;
    }
  }

  /**
   * Programmatic aim tree oluşturma (test / CI için)
   */
  static create(aim: string, children: AimNode[] = []): AimNode {
    return {
      id: 'A1',
      aim,
      children,
      linkedTasks: [],
      priority: 'critical',
    };
  }

  /**
   * Aim tree'yi AIMS.md formatında render et
   */
  renderMarkdown(root: AimNode): string {
    const lines: string[] = [];
    lines.push('# AIM TREE');
    lines.push('');
    lines.push('> Tümdengelim (top-down) amaç hiyerarşisi');
    lines.push('');
    this.renderNode(root, lines, 0);
    return lines.join('\n');
  }

  /**
   * Aim tree'yi konsola yazdır
   */
  printTree(root: AimNode): void {
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║           🎯 AIM TREE                        ║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
    this.printNode(root, '  ', true);
    console.log('');
  }

  // ── Private: Recursive Collection ────────────────────────

  private async collectChildren(parent: AimNode, depth: number): Promise<void> {
    if (depth >= MAX_DEPTH) return;

    const depthLabel = depth === 1 ? 'Alt amaçlar' : 'Bunun alt adımları';
    const indent = '  '.repeat(depth + 1);

    console.log(`\n${indent}📌 "${parent.aim}"`);
    console.log(`${indent}${depthLabel} neler? (her satıra bir tane, boş satır bitir)`);

    const subAims = await this.askMultiline(`${indent}> `);

    for (let i = 0; i < subAims.length; i++) {
      const child: AimNode = {
        id: `${parent.id}.${i + 1}`,
        aim: subAims[i]!,
        children: [],
        linkedTasks: [],
        priority: depth === 1 ? 'high' : 'medium',
      };
      parent.children.push(child);

      // Deeper decomposition sadece ilk 2 seviye için sor
      if (depth < MAX_DEPTH - 1 && subAims.length <= 5) {
        const goDeeper = await this.ask(
          `${indent}  ↳ "${child.aim}" daha da ayrıştırılsın mı? (e/h) > `
        );
        if (goDeeper.trim().toLowerCase() === 'e' || goDeeper.trim().toLowerCase() === 'y') {
          await this.collectChildren(child, depth + 1);
        }
      }
    }
  }

  // ── Private: Rendering ───────────────────────────────────

  private renderNode(node: AimNode, lines: string[], depth: number): void {
    const indent = '  '.repeat(depth);
    const prefix = depth === 0 ? '##' : '-';
    const taskRef = node.linkedTasks.length > 0
      ? ` → [${node.linkedTasks.join(', ')}]`
      : '';
    const prio = node.priority !== 'medium' ? ` (${node.priority})` : '';

    if (depth === 0) {
      lines.push(`## 🎯 ${node.id}: ${node.aim}${prio}`);
    } else {
      lines.push(`${indent}${prefix} **${node.id}**: ${node.aim}${prio}${taskRef}`);
    }

    for (const child of node.children) {
      this.renderNode(child, lines, depth + 1);
    }

    if (depth === 0 && node.children.length === 0) {
      lines.push('');
      lines.push('_(Alt amaç tanımlanmamış)_');
    }
    lines.push('');
  }

  private printNode(node: AimNode, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    const prioIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' }[node.priority];
    const taskRef = node.linkedTasks.length > 0
      ? ` → [${node.linkedTasks.join(', ')}]`
      : '';

    if (prefix === '  ') {
      // root
      console.log(`  ${prioIcon} ${node.id}: ${node.aim}`);
    } else {
      console.log(`${prefix}${connector}${prioIcon} ${node.id}: ${node.aim}${taskRef}`);
    }

    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      this.printNode(node.children[i]!, childPrefix, i === node.children.length - 1);
    }
  }

  // ── Private: Input Helpers ───────────────────────────────

  private ask(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl!.question(prompt, resolve);
    });
  }

  private async askMultiline(prompt: string): Promise<string[]> {
    const lines: string[] = [];
    while (true) {
      const line = await this.ask(prompt);
      if (line.trim() === '') break;
      lines.push(line.trim());
    }
    return lines;
  }
}
