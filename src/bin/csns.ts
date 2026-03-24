#!/usr/bin/env node

/**
 * CSNS CLI — Code-aware Self-correcting Never-forgetting System
 *
 * Interactive command-based interface. Waits for user input.
 *
 * Commands:
 *   /new [brief]    → Start a new project (SmartBrief → Orchestrator)
 *   /audit          → Reverse-engineer & audit current codebase
 *   /trace          → Run Tracer Agent (static + semantic + runtime + audit)
 *   /status         → Show STATE.md
 *   /log            → Show DECISIONS.md
 *   /health         → Quick health check (LLM + agent CLI)
 *   /help           → List commands
 *   /quit           → Exit
 *
 * Non-interactive:
 *   csns new "Build a todo API"
 *   csns audit
 *   csns trace
 *   csns status
 */

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setLocale } from '../i18n/index.js';
import { createProvider } from '../llm/factory.js';
import type { Locale } from '../i18n/index.js';
import type { OrchestratorConfig } from '../types/index.js';
import type { LLMProvider } from '../llm/types.js';

// Version'ı package.json'dan oku — hardcoded tutmak sync sorununa neden olur
import { createRequire } from 'node:module';
const __require = createRequire(import.meta.url);
const VERSION = (__require('../../package.json') as { version: string }).version;
const PROJECT_ROOT = process.cwd();

// ── Config ────────────────────────────────────────────────

function buildConfig(): OrchestratorConfig {
  const locale = (process.env['PC_LOCALE'] ?? process.env['CSNS_LOCALE'] ?? 'en') as Locale;
  setLocale(locale);

  return {
    projectRoot: PROJECT_ROOT,
    llmApiKey: process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '',
    llmModel: process.env['LLM_MODEL'] ?? process.env['CLAUDE_MODEL'],
    llmProvider: (process.env['LLM_PROVIDER'] as OrchestratorConfig['llmProvider']) ?? undefined,
    llmBaseUrl: process.env['LLM_BASE_URL'],
    agentBinary: process.env['AGENT_BINARY'] ?? 'claude',
    locale,
    maxRetries: 3,
    escalationThreshold: 0.4,
    maxParallelAgents: 3,
    verbose: true,
    // backward compat
    claudeApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    model: process.env['CLAUDE_MODEL'] ?? process.env['LLM_MODEL'],
  };
}

function getProvider(config: OrchestratorConfig): LLMProvider | null {
  try {
    return createProvider({
      provider: config.llmProvider ?? 'anthropic',
      apiKey: config.llmApiKey ?? config.claudeApiKey,
      model: config.llmModel ?? config.model,
      baseUrl: config.llmBaseUrl,
    });
  } catch {
    return null;
  }
}

// ── Command Handlers ──────────────────────────────────────

async function cmdNew(brief: string, config: OrchestratorConfig): Promise<void> {
  // ── Phase 1: Brief Collection (LLM gerektirmez) ──────────
  let resolvedBrief = brief.trim();
  let collectedBrief: import('../types/index.js').Brief | undefined;

  if (!resolvedBrief) {
    const { BriefCollector } = await import('../brief/index.js');
    const collector = new BriefCollector();
    collectedBrief = await collector.collect();

    const missionPath = join(PROJECT_ROOT, 'MISSION.md');
    await collector.writeMission(collectedBrief, missionPath);

    // Create other memory files
    await ensureMemoryFiles(collectedBrief.scope.stack);

    try {
      resolvedBrief = await readFile(missionPath, 'utf-8');
    } catch {
      console.error('  ❌ Failed to read MISSION.md after init');
      return;
    }

    console.log('\n  ✅ Project initialized — 4 memory files created');
    console.log('  📄 MISSION.md / ARCHITECTURE.md / DECISIONS.md / STATE.md\n');
  }

  // ── Phase 2: Plan Generation (LLM gerektirmez) ───────────
  if (collectedBrief) {
    const { PlanGenerator, AimCollector, computeCoverage, printCoverage, renderCoverageMd } =
      await import('../planner/index.js');
    const { writeFile: wf } = await import('node:fs/promises');

    // 2a. Tech plan
    const planner = new PlanGenerator(PROJECT_ROOT);
    const plan = await planner.generate(collectedBrief);
    planner.printPlan(plan);

    // 2b. Aim tree — tümdengelim planlama
    const wantAims = await askUser(
      '  🎯 Amaç ağacı oluşturmak ister misin? (tümdengelim planlama) (e/h) > '
    );

    if (wantAims.trim().toLowerCase() === 'e' || wantAims.trim().toLowerCase() === 'y') {
      const aimCollector = new AimCollector();
      const aimTree = aimCollector.collect ? await aimCollector.collect() : undefined;

      if (aimTree) {
        plan.aimTree = aimTree;

        // Coverage matrix hesapla
        plan.coverage = computeCoverage(aimTree, plan.phases);

        // Göster
        aimCollector.printTree(aimTree);
        printCoverage(plan.coverage);

        // AIMS.md yaz
        const aimsMd = aimCollector.renderMarkdown(aimTree) + '\n\n' + renderCoverageMd(plan.coverage);
        await wf(join(PROJECT_ROOT, 'AIMS.md'), aimsMd, 'utf-8');
        console.log('  ✅ AIMS.md yazıldı\n');
      }
    }

    // PLAN.md yaz
    await planner.writePlan(plan);
    console.log('  ✅ PLAN.md yazıldı\n');

    // Kullanıcıya sor: devam mı, düzenle mi, bitir mi?
    const answer = await askUser(
      '  Ne yapmak istersin?\n' +
      '    1. 🚀 Execute — LLM ile planı çalıştır (API key gerekir)\n' +
      '    2. ✏️  Edit — PLAN.md / AIMS.md düzenle, sonra tekrar gel\n' +
      '    3. ✅ Done — Sadece planla, şimdilik yeterli\n' +
      '  > '
    );

    if (answer.trim() === '2' || answer.trim().toLowerCase() === 'edit') {
      console.log('  📝 PLAN.md / AIMS.md dosyalarını düzenle, sonra /new ile tekrar çalıştır.\n');
      return;
    }

    if (answer.trim() === '3' || answer.trim().toLowerCase() === 'done') {
      console.log('  ✅ Plan hazır. İstediğin zaman /new ile execution\'a geçebilirsin.\n');
      return;
    }
  }

  // ── Phase 3: LLM Execution (API key gerekir) ────────────
  if (!config.llmApiKey && !process.env['OLLAMA_HOST']) {
    config = await ensureApiKey(config);
    if (!config.llmApiKey && !process.env['OLLAMA_HOST']) {
      console.error('  ❌ LLM API key required for execution. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_HOST\n');
      console.log('  💡 Plan ve proje dosyaları oluşturuldu — API key ayarlayıp /new ile devam edebilirsin.\n');
      return;
    }
  }

  console.log('  🚀 Starting orchestration...\n');
  const { Orchestrator } = await import('../orchestrator/index.js');
  const orchestrator = new Orchestrator(config);
  const session = await orchestrator.run(resolvedBrief);

  console.log(`\n  ✅ Session: ${session.sessionId}`);
  console.log(`  📊 Steps: ${session.steps.length}`);
  console.log(`  📌 Phase: ${session.finalState?.phase ?? 'unknown'}`);
}

async function askUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function cmdAudit(config: OrchestratorConfig): Promise<void> {
  console.log('  🔍 Running reverse engineering audit...\n');

  const { ReverseEngineer } = await import('../agent/tracer/reverse-engineer.js');
  const { StaticAnalyzer } = await import('../agent/tracer/static-analyzer.js');
  const provider = getProvider(config);

  const analyzer = new StaticAnalyzer(PROJECT_ROOT);
  const { imports, exports, edges } = await analyzer.buildGraph();

  // Read memory files
  const memoryFiles = await readMemoryFiles();

  const auditor = new ReverseEngineer(PROJECT_ROOT, provider);
  const report = await auditor.audit(imports, exports, edges, memoryFiles);

  // Print report
  console.log('  ═══════════════════════════════════════════');
  console.log('  📋 AUDIT REPORT');
  console.log('  ═══════════════════════════════════════════\n');

  // Layer distribution
  console.log('  🏗️  Layer Distribution:');
  for (const [layer, count] of Object.entries(report.summary.layerDistribution)) {
    if (count > 0) console.log(`     ${layer}: ${count} files`);
  }

  // Data flows
  console.log(`\n  🔀 Data Flows: ${report.summary.completeFlows}/${report.summary.totalFlows} complete`);
  for (const flow of report.dataFlows) {
    const icon = flow.complete ? '✅' : '⚠️';
    const chain = flow.steps.map(s => s.layer).join(' → ');
    console.log(`     ${icon} ${flow.trigger}: ${chain}`);
  }

  // Violations
  if (report.violations.length > 0) {
    console.log(`\n  ⚠️  Violations: ${report.violations.length}`);
    for (const v of report.violations) {
      const icon = v.severity === 'critical' ? '🚨' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`     ${icon} [${v.type}] ${v.description}`);
    }
  }

  // Decision audit
  if (report.decisionAudit.length > 0) {
    console.log(`\n  📜 Decision Audit: ${report.summary.decisionsImplemented}/${report.summary.decisionsTotal} implemented`);
    for (const d of report.decisionAudit) {
      const icon = d.status === 'implemented' ? '✅' :
                   d.status === 'contradicted' ? '🚨' :
                   d.status === 'partially-implemented' ? '⚠️' : '❌';
      console.log(`     ${icon} ${d.decisionId}: ${d.title} → ${d.status}`);
    }
  }

  // Patterns
  if (report.patterns.length > 0) {
    console.log(`\n  🧩 Patterns: ${report.patterns.map(p => p.name).join(', ')}`);
  }

  console.log(`\n  💯 Health Score: ${report.summary.healthScore}/100`);
  console.log('  ═══════════════════════════════════════════\n');
}

async function cmdTrace(config: OrchestratorConfig): Promise<void> {
  console.log('  🔍 Running full trace (4 layers)...\n');

  const { TracerAgent } = await import('../agent/tracer/tracer-agent.js');
  const provider = getProvider(config);

  const tracer = new TracerAgent({
    projectRoot: PROJECT_ROOT,
    llmProvider: provider,
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    log: (msg) => console.log(`  ${msg}`),
  });

  const report = await tracer.run();

  console.log(`\n  📊 Total issues: ${report.summary.totalIssues}`);
  console.log(`     🚨 Critical: ${report.summary.criticalCount}`);
  console.log(`     ⚠️  Warning: ${report.summary.warningCount}`);
}

async function cmdReview(args: string, config: OrchestratorConfig): Promise<void> {
  console.log('  🔍 Reviewing changes...\n');

  const { PRReviewer } = await import('../orchestrator/pr-reviewer.js');
  const provider = getProvider(config);
  const reviewer = new PRReviewer(PROJECT_ROOT, provider);

  const isAll = args.includes('--all');
  const commitMatch = args.match(/--commit\s+(\S+)/);
  const scope = commitMatch ? 'commit' as const : isAll ? 'all' as const : 'staged' as const;

  const result = await reviewer.review(scope, commitMatch?.[1]);

  // Print markdown to terminal
  console.log(result.markdown);
  console.log(`  ⏱️ ${result.duration}ms\n`);
}

async function cmdStatus(): Promise<void> {
  try {
    const content = await readFile(join(PROJECT_ROOT, 'STATE.md'), 'utf-8');
    console.log(`\n${content}`);
  } catch {
    console.error('  ❌ STATE.md not found. Run /new first.');
  }
}

async function cmdLog(): Promise<void> {
  try {
    const content = await readFile(join(PROJECT_ROOT, 'DECISIONS.md'), 'utf-8');
    console.log(`\n${content}`);
  } catch {
    console.error('  ❌ DECISIONS.md not found. Run /new first.');
  }
}

async function cmdHealth(config: OrchestratorConfig): Promise<void> {
  console.log('  Checking...\n');

  // LLM provider
  const provider = getProvider(config);
  if (provider) {
    const health = await provider.healthCheck();
    console.log(`  🧠 LLM (${provider.name}): ${health.ok ? '✅' : '❌'} ${health.detail}`);
  } else {
    console.log('  🧠 LLM: ❌ No provider configured');
  }

  // Agent CLI
  const { ProcessSpawner } = await import('../agent/process-spawner.js');
  const spawner = new ProcessSpawner(config.agentBinary ?? 'claude');
  const agentHealth = await spawner.healthCheck();
  console.log(`  🤖 Agent CLI (${config.agentBinary ?? 'claude'}): ${agentHealth.available ? '✅' : '❌'} ${agentHealth.version ?? agentHealth.error ?? ''}`);

  // Memory files
  const files = ['MISSION.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'STATE.md'];
  for (const f of files) {
    try {
      await readFile(join(PROJECT_ROOT, f), 'utf-8');
      console.log(`  📄 ${f}: ✅`);
    } catch {
      console.log(`  📄 ${f}: ❌ not found`);
    }
  }
  console.log();
}

function printInteractiveMenu(): void {
  console.log(`
  ╭──────────────────────────────────────────╮
  │  What do you want to do?                 │
  ├──────────────────────────────────────────┤
  │                                          │
  │  🔨 Build                                │
  │    /new [brief]     Create a new project │
  │                                          │
  │  🔍 Analyze                              │
  │    /audit           Full architecture    │
  │                     audit (5 layers)     │
  │    /review          Review git changes   │
  │    /review --all    All uncommitted      │
  │    /trace           Deep 4-layer trace   │
  │                                          │
  │  📊 Status                               │
  │    /status          Show STATE.md        │
  │    /log             Show DECISIONS.md    │
  │    /health          Check LLM + tools    │
  │                                          │
  │  ⚙️  Other                               │
  │    /help            Full help text       │
  │    /quit            Exit                 │
  │                                          │
  ╰──────────────────────────────────────────╯
`);
}

function printHelp(): void {
  console.log(`
  Commands:
    /new [brief]    Start a new project (interactive if no brief given)
    /audit          Reverse-engineer & audit current codebase
    /review         Review staged git changes (security + architecture)
    /review --all   Review all uncommitted changes
    /trace          Full 4-layer trace (static + semantic + runtime + audit)
    /status         Show STATE.md
    /log            Show DECISIONS.md
    /health         Check LLM, agent CLI, and memory files
    /help           This message
    /quit           Exit

  Environment:
    ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_HOST   LLM provider
    LLM_PROVIDER       Force: anthropic | openai | ollama
    LLM_MODEL          Model name
    AGENT_BINARY        Coding agent CLI (default: claude)
    CSNS_LOCALE         Language: en | tr (default: en)
`);
}

function printBanner(): void {
  console.log(`
  \x1b[36m
  ███╗   ███╗ █████╗ ███╗   ██╗██████╗  ██████╗ ███████╗██╗
  ████╗ ████║██╔══██╗████╗  ██║██╔══██╗██╔═══██╗██╔════╝██║
  ██╔████╔██║███████║██╔██╗ ██║██║  ██║██║   ██║███████╗██║
  ██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║██║   ██║╚════██║██║
  ██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝╚██████╔╝███████║██║
  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚══════╝╚═╝
  \x1b[0m
  \x1b[2mCode-aware Self-correcting Never-forgetting System  v${VERSION}\x1b[0m

  Type \x1b[33m/\x1b[0m for commands, \x1b[33m/quit\x1b[0m to exit.
`);
}

// ── Interactive REPL ──────────────────────────────────────

// ── Command Registry ────────────────────────────────────────

interface CommandEntry {
  cmd: string;
  label: string;
  description: string;
  group: string;
}

const COMMANDS: CommandEntry[] = [
  { cmd: '/new',         label: '🔨 /new [brief]',   description: 'Create a new project',                group: 'Build' },
  { cmd: '/audit',       label: '🔍 /audit',          description: 'Full architecture audit (5 layers)',  group: 'Analyze' },
  { cmd: '/review',      label: '🔍 /review',         description: 'Review staged git changes',           group: 'Analyze' },
  { cmd: '/review --all',label: '🔍 /review --all',   description: 'Review all uncommitted changes',      group: 'Analyze' },
  { cmd: '/trace',       label: '🔍 /trace',          description: 'Deep 4-layer trace',                  group: 'Analyze' },
  { cmd: '/status',      label: '📊 /status',         description: 'Show STATE.md',                       group: 'Status' },
  { cmd: '/log',         label: '📊 /log',            description: 'Show DECISIONS.md',                   group: 'Status' },
  { cmd: '/health',      label: '📊 /health',         description: 'Check LLM + tools',                   group: 'Status' },
  { cmd: '/help',        label: '⚙️  /help',          description: 'Full help text',                      group: 'Other' },
  { cmd: '/quit',        label: '⚙️  /quit',          description: 'Exit',                                group: 'Other' },
];

/**
 * Arrow-key interactive command selector.
 * Tüm komutları listeler, yukarı/aşağı ile seçim yapılır, Enter ile çalıştırılır.
 */
async function interactiveCommandSelect(): Promise<string> {
  const items = COMMANDS.filter(c => c.cmd !== '/quit'); // quit'i menüden çıkar
  let selected = 0;

  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    function render() {
      // Cursor'u menü başına taşı
      stdout.write(`\x1b[${items.length + 2}A\x1b[J`);

      stdout.write('  ╭─── Select a command (↑↓ Enter) ───────────╮\n');
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const pointer = i === selected ? '\x1b[36m❯\x1b[0m' : ' ';
        const highlight = i === selected ? '\x1b[1m' : '\x1b[2m';
        const pad = item.description.padEnd(32);
        stdout.write(`  │ ${pointer} ${highlight}${item.label.padEnd(18)} ${pad}\x1b[0m│\n`);
      }
      stdout.write('  ╰─────────────────────────────────────────────╯\n');
    }

    // İlk render için boş satırlar
    stdout.write('\n'.repeat(items.length + 2));
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
        resolve(items[selected]!.cmd);
      } else if (s === '\x1b' || s === '\x03' || s === 'q') { // Esc, Ctrl+C, q
        cleanup();
        resolve('');
      }
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

async function repl(config: OrchestratorConfig): Promise<void> {
  printBanner();

  const COMMAND_NAMES = COMMANDS.map(c => c.cmd);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '  csns> ',
    completer: (line: string) => {
      if (line.startsWith('/')) {
        const hits = COMMAND_NAMES.filter(c => c.startsWith(line));
        return [hits.length > 0 ? hits : COMMAND_NAMES, line];
      }
      return [[], line];
    },
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    try {
      // "/" tek başına → interaktif seçim menüsü
      if (input === '/' || input === '/?') {
        rl.pause();
        const selected = await interactiveCommandSelect();
        rl.resume();

        if (selected) {
          console.log(`  ▸ ${selected}\n`);
          // Seçilen komutu çalıştır (recursive)
          rl.emit('line', selected);
        } else {
          rl.prompt();
        }
        return;
      }

      if (input.startsWith('/new')) {
        await cmdNew(input.slice(4).trim(), config);
      } else if (input === '/audit') {
        await cmdAudit(config);
      } else if (input.startsWith('/review')) {
        await cmdReview(input.slice(7).trim(), config);
      } else if (input === '/trace') {
        await cmdTrace(config);
      } else if (input === '/status') {
        await cmdStatus();
      } else if (input === '/log') {
        await cmdLog();
      } else if (input === '/health') {
        await cmdHealth(config);
      } else if (input === '/help') {
        printInteractiveMenu();
      } else if (input === '/quit' || input === '/exit' || input === '/q') {
        console.log('\n  👋 Bye.\n');
        process.exit(0);
      } else if (input.startsWith('/')) {
        console.log(`  ❓ Unknown command: ${input.split(' ')[0]}. Type /help for commands.\n`);
      } else {
        // Bare text → treat as /new with inline brief
        console.log('  💡 Tip: use /new to start a project, /audit to analyze existing code.\n');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  💥 Error: ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n  👋 Bye.\n');
    process.exit(0);
  });
}

// ── Non-interactive Mode ──────────────────────────────────

async function nonInteractive(command: string, args: string, config: OrchestratorConfig): Promise<void> {
  switch (command) {
    case 'new':
      await cmdNew(args, config);
      break;
    case 'audit':
      await cmdAudit(config);
      break;
    case 'review':
      await cmdReview(args, config);
      break;
    case 'trace':
      await cmdTrace(config);
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'log':
      await cmdLog();
      break;
    case 'health':
      await cmdHealth(config);
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`csns v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
      printBanner();
      printHelp();
      break;
    default:
      console.error(`  ❓ Unknown command: ${command}. Run 'csns help' for usage.`);
      process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────

async function readMemoryFiles(): Promise<{ mission?: string; architecture?: string; decisions?: string }> {
  const read = async (name: string) => {
    try { return await readFile(join(PROJECT_ROOT, name), 'utf-8'); }
    catch { return undefined; }
  };
  return {
    mission: await read('MISSION.md'),
    architecture: await read('ARCHITECTURE.md'),
    decisions: await read('DECISIONS.md'),
  };
}

async function ensureMemoryFiles(stack?: string): Promise<void> {
  const { writeFile: wf } = await import('node:fs/promises');
  const ensure = async (name: string, content: string) => {
    try { await readFile(join(PROJECT_ROOT, name), 'utf-8'); }
    catch { await wf(join(PROJECT_ROOT, name), content, 'utf-8'); }
  };

  await ensure('ARCHITECTURE.md', `# ARCHITECTURE\n\n## Stack\n${stack ?? 'Not specified'}\n`);
  await ensure('DECISIONS.md', `# DECISIONS\n\n> Append-only log. Decisions are never deleted.\n`);
  await ensure('STATE.md', `# STATE\n\n## Current Phase: \`initialization\`\n\n## Iteration: 0\n\n## Active Tasks\n_none_\n\n## Completed Tasks\n_none yet_\n\n## Blocked\n_none_\n\n## Last Updated: ${new Date().toISOString()}\n`);
}

// ── First-Run Setup ──────────────────────────────────────

/** Read a line from stdin with masked echo (prints * for each character) */
function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const buf: string[] = [];

    if (!process.stdin.isTTY) {
      // Non-TTY fallback: read one line without masking
      const { createInterface: rlCreate } = require('node:readline');
      const rl = rlCreate({ input: process.stdin, output: process.stdout });
      rl.question('', (answer: string) => { rl.close(); resolve(answer); });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (key: string) => {
      const code = key.charCodeAt(0);
      if (key === '\r' || key === '\n') {
        // Enter
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf.join(''));
      } else if (code === 127 || code === 8) {
        // Backspace
        if (buf.length > 0) {
          buf.pop();
          process.stdout.write('\b \b');
        }
      } else if (code === 3) {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve('');
      } else if (code >= 32) {
        // Printable character
        buf.push(key);
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

async function ensureApiKey(config: OrchestratorConfig): Promise<OrchestratorConfig> {
  // Already has a key
  if (config.llmApiKey || process.env['OLLAMA_HOST']) return config;

  // Check if .env exists with a key
  try {
    const envContent = await readFile(join(PROJECT_ROOT, '.env'), 'utf-8');
    const match = envContent.match(/^(ANTHROPIC_API_KEY|OPENAI_API_KEY)=(.+)$/m);
    if (match?.[2]) {
      process.env[match[1]!] = match[2];
      return { ...config, llmApiKey: match[2] };
    }
  } catch { /* no .env */ }

  // Interactive setup
  console.log(`
  ╭──────────────────────────────────────────╮
  │  🔑 First-time setup                    │
  ├──────────────────────────────────────────┤
  │                                          │
  │  MANDOSI needs an LLM API key for:      │
  │  • /new (project generation)             │
  │  • /trace (semantic analysis)            │
  │                                          │
  │  /audit, /review, /health work           │
  │  WITHOUT an API key.                     │
  │                                          │
  │  Choose your provider:                   │
  │   1. Anthropic (Claude)                  │
  │   2. OpenAI (GPT)                        │
  │   3. Ollama (local, no key needed)       │
  │   4. Skip for now                        │
  │                                          │
  ╰──────────────────────────────────────────╯
`);

  const { createInterface: rlCreate } = await import('node:readline');
  const rl = rlCreate({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const choice = await ask('  Choice (1-4): ');

  if (choice.trim() === '4' || !choice.trim()) {
    rl.close();
    console.log('  ⏭️  Skipped. You can set API keys later in .env\n');
    return config;
  }

  if (choice.trim() === '3') {
    const host = await ask('  Ollama host (Enter for http://localhost:11434): ');
    const ollamaHost = host.trim() || 'http://localhost:11434';
    process.env['OLLAMA_HOST'] = ollamaHost;
    process.env['LLM_PROVIDER'] = 'ollama';

    // Save to .env
    await appendEnv(`LLM_PROVIDER=ollama\nOLLAMA_HOST=${ollamaHost}\n`);
    rl.close();
    console.log(`  ✅ Ollama configured (${ollamaHost}). Saved to .env\n`);
    return { ...config, llmProvider: 'ollama', llmBaseUrl: ollamaHost };
  }

  const providerName = choice.trim() === '1' ? 'Anthropic' : 'OpenAI';
  const envKey = choice.trim() === '1' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const hint = choice.trim() === '1' ? 'sk-ant-...' : 'sk-...';

  rl.close();
  const apiKey = await askSecret(`  ${providerName} API key (${hint}): `);

  if (!apiKey.trim()) {
    console.log('  ⏭️  No key entered. Skipped.\n');
    return config;
  }

  // Save to .env
  process.env[envKey] = apiKey.trim();
  const providerType = choice.trim() === '1' ? 'anthropic' : 'openai';
  await appendEnv(`LLM_PROVIDER=${providerType}\n${envKey}=${apiKey.trim()}\n`);

  console.log(`  ✅ ${providerName} configured. Saved to .env\n`);
  console.log(`  \x1b[2m💡 Add .env to .gitignore to keep your key safe\x1b[0m\n`);

  return {
    ...config,
    llmApiKey: apiKey.trim(),
    llmProvider: providerType as OrchestratorConfig['llmProvider'],
  };
}

async function appendEnv(content: string): Promise<void> {
  const envPath = join(PROJECT_ROOT, '.env');
  const { writeFile: wf, readFile: rf } = await import('node:fs/promises');
  let existing = '';
  try { existing = await rf(envPath, 'utf-8'); } catch { /* no .env */ }
  await wf(envPath, existing ? existing.trimEnd() + '\n' + content : content);

  // Auto-add .env to .gitignore if not already there
  const gitignorePath = join(PROJECT_ROOT, '.gitignore');
  try {
    let gi = '';
    try { gi = await rf(gitignorePath, 'utf-8'); } catch { /* no .gitignore */ }
    if (!gi.includes('.env')) {
      await wf(gitignorePath, gi ? gi.trimEnd() + '\n.env\n' : '.env\n');
    }
  } catch { /* ignore */ }
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  let config = buildConfig();
  const [command, ...rest] = process.argv.slice(2);

  // Only run interactive setup for non-interactive /new command
  // REPL defers key setup to when /new or /trace is actually called
  if (command === 'new') {
    config = await ensureApiKey(config);
  }

  if (command) {
    await nonInteractive(command, rest.join(' '), config);
  } else {
    await repl(config);
  }
}

main().catch((error) => {
  console.error('💥 Fatal:', error);
  process.exit(1);
});
