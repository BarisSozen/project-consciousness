/**
 * Interactive Selector — Arrow-Key Decision Picker
 *
 * Reusable UI component for interactive CLI decisions:
 * - Arrow keys (↑↓) to navigate
 * - Enter to select
 * - Smart default highlighted with ★
 * - "Other" option for custom input
 * - Color-coded with ANSI
 *
 * Used by: ArchitectAgent, SmartBrief, PlanGenerator
 */

export interface SelectOption {
  key: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface SelectQuestion {
  title: string;
  icon?: string;
  options: SelectOption[];
  /** Allow "other" free-text option */
  allowOther?: boolean;
}

export interface SelectResult {
  key: string;
  label: string;
  isCustom: boolean;
}

/**
 * Present an arrow-key selection menu.
 * If stdin is not a TTY (CI/pipe), falls back to auto-selecting recommended or first option.
 */
export async function interactiveSelect(question: SelectQuestion): Promise<SelectResult> {
  const items = [...question.options];
  if (question.allowOther) {
    items.push({ key: '__other__', label: 'Other (custom input)', description: 'Type your own answer' });
  }

  // Find recommended index
  const recommendedIdx = items.findIndex(o => o.recommended);
  const defaultIdx = recommendedIdx >= 0 ? recommendedIdx : 0;

  // Non-TTY fallback
  if (!process.stdin.isTTY) {
    const selected = items[defaultIdx]!;
    console.log(`  ${question.icon ?? '?'} ${question.title}: ${selected.label} (auto-selected)`);
    return { key: selected.key, label: selected.label, isCustom: false };
  }

  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let selected = defaultIdx;
    const wasRaw = stdin.isRaw;

    // Render
    function render() {
      // Move cursor up and clear
      stdout.write(`\x1b[${items.length + 3}A\x1b[J`);

      const icon = question.icon ?? '?';
      stdout.write(`\n  ${icon} \x1b[1m${question.title}\x1b[0m\n`);

      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const pointer = i === selected ? '\x1b[36m❯\x1b[0m' : ' ';
        const rec = item.recommended ? ' \x1b[33m★ recommended\x1b[0m' : '';
        const highlight = i === selected ? '\x1b[1m' : '\x1b[2m';
        const desc = item.description ? `\x1b[2m — ${item.description}\x1b[0m` : '';
        stdout.write(`  ${pointer} ${highlight}${item.label}\x1b[0m${rec}${desc}\n`);
      }

      stdout.write(`  \x1b[2m↑↓ navigate, Enter select, Esc skip\x1b[0m\n`);
    }

    // Print initial blank lines
    stdout.write('\n'.repeat(items.length + 3));
    stdin.setRawMode(true);
    stdin.resume();
    render();

    function onKey(key: Buffer) {
      const s = key.toString();

      if (s === '\x1b[A') { // Up
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (s === '\x1b[B') { // Down
        selected = (selected + 1) % items.length;
        render();
      } else if (s === '\r' || s === '\n') { // Enter
        cleanup();
        const item = items[selected]!;

        if (item.key === '__other__') {
          // Ask for custom input
          handleOther(resolve);
        } else {
          stdout.write(`  \x1b[32m✓\x1b[0m ${item.label}\n\n`);
          resolve({ key: item.key, label: item.label, isCustom: false });
        }
      } else if (s === '\x1b' || s === '\x03') { // Esc or Ctrl+C
        cleanup();
        const item = items[defaultIdx]!;
        stdout.write(`  \x1b[33m→\x1b[0m ${item.label} (default)\n\n`);
        resolve({ key: item.key, label: item.label, isCustom: false });
      }
    }

    function handleOther(res: (value: SelectResult) => void) {
      stdout.write('  ✏️  Enter custom value: ');
      stdin.setRawMode(false);
      const { createInterface } = require('node:readline');
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question('', (answer: string) => {
        rl.close();
        const trimmed = answer.trim();
        if (trimmed) {
          stdout.write(`  \x1b[32m✓\x1b[0m ${trimmed}\n\n`);
          res({ key: trimmed, label: trimmed, isCustom: true });
        } else {
          const item = items[defaultIdx]!;
          res({ key: item.key, label: item.label, isCustom: false });
        }
      });
    }

    function cleanup() {
      stdin.removeListener('data', onKey);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw ?? false);
      }
    }

    stdin.on('data', onKey);
  });
}

/**
 * Present multiple decisions in sequence.
 * Returns a map of question title → selected key.
 */
export async function interactiveDecisions(
  questions: SelectQuestion[]
): Promise<Map<string, SelectResult>> {
  const results = new Map<string, SelectResult>();

  for (const q of questions) {
    const result = await interactiveSelect(q);
    results.set(q.title, result);
  }

  return results;
}

/**
 * Infer smart defaults from brief text.
 * Returns a map of question key → recommended option key.
 */
export function inferRecommendations(brief: string): Map<string, string> {
  const recommendations = new Map<string, string>();
  const b = brief.toLowerCase();

  // Auth (English + Turkish)
  if (b.includes('login') || b.includes('register') || b.includes('auth') || b.includes('user') ||
      b.includes('giriş') || b.includes('girişi') || b.includes('kayıt') || b.includes('kullanıcı') || b.includes('oturum')) {
    recommendations.set('auth', 'jwt');
  } else if (b.includes('api key') || b.includes('apikey')) {
    recommendations.set('auth', 'api-key');
  }

  // Database
  if (b.includes('e-commerce') || b.includes('eticaret') || b.includes('e-ticaret') || b.includes('production') || b.includes('scale')) {
    recommendations.set('database', 'postgresql');
  } else if (b.includes('simple') || b.includes('basit') || b.includes('todo') || b.includes('prototype') || b.includes('mvp')) {
    recommendations.set('database', 'sqlite');
  } else if (b.includes('document') || b.includes('flexible') || b.includes('nosql')) {
    recommendations.set('database', 'mongodb');
  }

  // API Style
  if (b.includes('graphql')) {
    recommendations.set('apiStyle', 'graphql');
  } else if (b.includes('trpc') || b.includes('type-safe')) {
    recommendations.set('apiStyle', 'trpc');
  } else {
    recommendations.set('apiStyle', 'rest');
  }

  // Frontend
  if (b.includes('fullstack') || b.includes('full-stack') || b.includes('frontend') || /\bui\b/.test(b) || b.includes('dashboard')) {
    if (b.includes('next') || b.includes('ssr')) {
      recommendations.set('frontend', 'nextjs');
    } else {
      recommendations.set('frontend', 'react');
    }
  } else {
    recommendations.set('frontend', 'api-only');
  }

  // Deployment
  if (b.includes('docker') || b.includes('container')) {
    recommendations.set('deployment', 'docker');
  } else if (b.includes('cloud') || b.includes('aws') || b.includes('vercel') || b.includes('deploy')) {
    recommendations.set('deployment', 'cloud');
  }

  return recommendations;
}
