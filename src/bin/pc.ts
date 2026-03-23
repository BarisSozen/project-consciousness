#!/usr/bin/env node

/**
 * Project Consciousness CLI
 * 
 * Komutlar:
 *   pc init     → BriefCollector çalışır, MISSION.md oluşur
 *   pc run      → Orchestrator başlar
 *   pc status   → STATE.md gösterir
 *   pc log      → DECISIONS.md gösterir
 *   pc version  → Versiyon bilgisi
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BriefCollector } from '../brief/index.js';
import { Orchestrator } from '../orchestrator/index.js';
import type { OrchestratorConfig } from '../types/index.js';

const PROJECT_ROOT = process.cwd();
const VERSION = '0.1.0';

// ── Command Router ──────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'run':
      await cmdRun(args.join(' '));
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'log':
      await cmdLog();
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`project-consciousness v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      // Komut yoksa, tüm args'ı brief olarak al → doğrudan run
      await cmdRun([command, ...args].join(' '));
      break;
  }
}

// ── pc init ─────────────────────────────────────────────

async function cmdInit(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   PROJECT CONSCIOUSNESS — Init                ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const collector = new BriefCollector();
  const brief = await collector.collect();

  const missionPath = join(PROJECT_ROOT, 'MISSION.md');
  await collector.writeMission(brief, missionPath);

  // Diğer hafıza dosyalarını oluştur (yoksa)
  await ensureFile(join(PROJECT_ROOT, 'ARCHITECTURE.md'), `# ARCHITECTURE

> Bu dosya teknik mimari kararları içerir.

## Stack
${brief.scope.stack === 'typescript-node' ? 'TypeScript + Node.js' : 
  brief.scope.stack === 'react' ? 'React (TypeScript)' :
  brief.scope.stack === 'python' ? 'Python' :
  brief.scope.stack === 'go' ? 'Go' : brief.scope.stackDetails ?? 'Belirtilmemiş'}

## Tasarım İlkeleri
1. Memory-First — her karar hafızada iz bırakır
2. Fail-Safe — şüphe durumunda insana sor
3. Append-Only Log — DECISIONS.md asla düzenlenmez
`);

  await ensureFile(join(PROJECT_ROOT, 'DECISIONS.md'), `# DECISIONS

> Append-only log. Kararlar asla silinmez, sadece superseded olabilir.
`);

  await ensureFile(join(PROJECT_ROOT, 'STATE.md'), `# STATE

## Current Phase: \`initialization\`

## Iteration: 0

## Active Tasks
_yok_

## Completed Tasks
_henüz yok_

## Blocked
_henüz yok_

## Last Updated: ${new Date().toISOString()}
`);

  console.log('\n✅ Proje başlatıldı!');
  console.log('   MISSION.md       ← brief yazıldı');
  console.log('   ARCHITECTURE.md  ← oluşturuldu');
  console.log('   DECISIONS.md     ← oluşturuldu');
  console.log('   STATE.md         ← oluşturuldu');
  console.log('\n🚀 Sonraki adım: pc run');
}

// ── pc run ──────────────────────────────────────────────

async function cmdRun(brief: string): Promise<void> {
  const config = getConfig();

  if (!config.claudeApiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable gerekli.');
    console.error('   export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  // Brief: argument'tan veya MISSION.md'den
  let resolvedBrief = brief;
  if (!resolvedBrief) {
    try {
      const mission = await readFile(join(PROJECT_ROOT, 'MISSION.md'), 'utf-8');
      resolvedBrief = mission;
      console.log('📄 Brief: MISSION.md\'den okundu');
    } catch {
      console.error('❌ Brief gerekli. Kullanım:');
      console.error('   pc run "Brief metni"');
      console.error('   veya önce: pc init');
      process.exit(1);
    }
  }

  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║   PROJECT CONSCIOUSNESS v${VERSION}             ║`);
  console.log('║   Multi-Agent Orchestration with Memory      ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const orchestrator = new Orchestrator(config);
  const session = await orchestrator.run(resolvedBrief);

  console.log('\n═══════════════════════════════════════════════');
  console.log(`✅ Session: ${session.sessionId}`);
  console.log(`📊 Adımlar: ${session.steps.length}`);
  console.log(`📌 Durum: ${session.finalState?.phase ?? 'unknown'}`);
  console.log('═══════════════════════════════════════════════');
}

// ── pc status ───────────────────────────────────────────

async function cmdStatus(): Promise<void> {
  try {
    const content = await readFile(join(PROJECT_ROOT, 'STATE.md'), 'utf-8');
    console.log(content);
  } catch {
    console.error('❌ STATE.md bulunamadı. Önce: pc init');
    process.exit(1);
  }
}

// ── pc log ──────────────────────────────────────────────

async function cmdLog(): Promise<void> {
  try {
    const content = await readFile(join(PROJECT_ROOT, 'DECISIONS.md'), 'utf-8');
    console.log(content);
  } catch {
    console.error('❌ DECISIONS.md bulunamadı. Önce: pc init');
    process.exit(1);
  }
}

// ── Help ────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
project-consciousness v${VERSION}
Multi-agent orchestration with persistent memory

KULLANIM:
  pc init                  Proje başlat (interaktif brief toplama)
  pc run [brief]           Orchestrator'ı çalıştır
  pc status                STATE.md göster
  pc log                   DECISIONS.md göster
  pc version               Versiyon bilgisi
  pc help                  Bu mesaj

ÖRNEKLER:
  pc init
  pc run "Build a TODO API with express"
  pc run                   # MISSION.md'den brief okur
  pc status

ENVIRONMENT:
  ANTHROPIC_API_KEY        Claude API key (zorunlu: pc run için)
  CLAUDE_MODEL             Model adı (varsayılan: claude-sonnet-4-20250514)
`);
}

// ── Helpers ─────────────────────────────────────────────

function getConfig(): OrchestratorConfig {
  return {
    projectRoot: PROJECT_ROOT,
    claudeApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    model: process.env['CLAUDE_MODEL'] ?? 'claude-sonnet-4-20250514',
    maxRetries: 3,
    escalationThreshold: 0.4,
    maxParallelAgents: 3,
    verbose: true,
  };
}

async function ensureFile(path: string, content: string): Promise<void> {
  try {
    await readFile(path, 'utf-8');
    // Dosya var, dokunma
  } catch {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, content, 'utf-8');
  }
}

main().catch((error) => {
  console.error('💥 Fatal:', error);
  process.exit(1);
});
