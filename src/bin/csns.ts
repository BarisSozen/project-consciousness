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

const VERSION = '0.6.0';
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
  if (!config.llmApiKey && !process.env['OLLAMA_HOST']) {
    console.error('  ❌ LLM API key required. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_HOST');
    return;
  }

  // If no brief given, collect interactively
  let resolvedBrief = brief.trim();
  if (!resolvedBrief) {
    const { BriefCollector } = await import('../brief/index.js');
    const collector = new BriefCollector();
    const collected = await collector.collect();

    const missionPath = join(PROJECT_ROOT, 'MISSION.md');
    await collector.writeMission(collected, missionPath);

    // Create other memory files
    await ensureMemoryFiles(collected.scope.stack);

    try {
      resolvedBrief = await readFile(missionPath, 'utf-8');
    } catch {
      console.error('  ❌ Failed to read MISSION.md after init');
      return;
    }

    console.log('\n  ✅ Project initialized — 4 memory files created');
    console.log('  📄 MISSION.md / ARCHITECTURE.md / DECISIONS.md / STATE.md\n');
  }

  // Run orchestrator
  console.log('  🚀 Starting orchestration...\n');
  const { Orchestrator } = await import('../orchestrator/index.js');
  const orchestrator = new Orchestrator(config);
  const session = await orchestrator.run(resolvedBrief);

  console.log(`\n  ✅ Session: ${session.sessionId}`);
  console.log(`  📊 Steps: ${session.steps.length}`);
  console.log(`  📌 Phase: ${session.finalState?.phase ?? 'unknown'}`);
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

function printHelp(): void {
  console.log(`
  Commands:
    /new [brief]    Start a new project (interactive if no brief given)
    /audit          Reverse-engineer & audit current codebase
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
  ╔══════════════════════════════════════════════╗
  ║   CSNS v${VERSION}                              ║
  ║   Code-aware Self-correcting                 ║
  ║   Never-forgetting System                    ║
  ╚══════════════════════════════════════════════╝

  Type /help for commands, /quit to exit.
`);
}

// ── Interactive REPL ──────────────────────────────────────

async function repl(config: OrchestratorConfig): Promise<void> {
  printBanner();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '  csns> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    try {
      if (input.startsWith('/new')) {
        await cmdNew(input.slice(4).trim(), config);
      } else if (input === '/audit') {
        await cmdAudit(config);
      } else if (input === '/trace') {
        await cmdTrace(config);
      } else if (input === '/status') {
        await cmdStatus();
      } else if (input === '/log') {
        await cmdLog();
      } else if (input === '/health') {
        await cmdHealth(config);
      } else if (input === '/help' || input === '/?') {
        printHelp();
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

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = buildConfig();
  const [command, ...rest] = process.argv.slice(2);

  if (command) {
    // Non-interactive: csns new "Build a todo API"
    await nonInteractive(command, rest.join(' '), config);
  } else {
    // Interactive REPL
    await repl(config);
  }
}

main().catch((error) => {
  console.error('💥 Fatal:', error);
  process.exit(1);
});
