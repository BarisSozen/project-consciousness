/**
 * Project Consciousness — Entry Point
 * 
 * CLI arayüzü: brief al → orchestrate → raporla
 */

import { Orchestrator } from './orchestrator/index.js';
import type { OrchestratorConfig } from './types/index.js';

async function main(): Promise<void> {
  const projectRoot = process.cwd();

  // Config
  const config: OrchestratorConfig = {
    projectRoot,
    claudeApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    model: process.env['CLAUDE_MODEL'] ?? 'claude-sonnet-4-20250514',
    maxRetries: 3,
    escalationThreshold: 0.4,
    maxParallelAgents: 3,
    verbose: true,
  };

  if (!config.claudeApiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Brief — komut satırından veya stdin'den
  const brief = process.argv.slice(2).join(' ') || await readStdin();

  if (!brief) {
    console.error('❌ Brief gerekli. Kullanım: npx tsx src/index.ts "brief metni"');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       PROJECT CONSCIOUSNESS v0.1.0           ║');
  console.log('║   Multi-Agent Orchestration with Memory      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log();
  console.log(`📄 Brief: ${brief.slice(0, 100)}${brief.length > 100 ? '...' : ''}`);
  console.log();

  const orchestrator = new Orchestrator(config);
  const session = await orchestrator.run(brief);

  console.log();
  console.log('═══════════════════════════════════════════════');
  console.log(`✅ Session tamamlandı: ${session.sessionId}`);
  console.log(`📊 Toplam adım: ${session.steps.length}`);
  console.log(`📌 Son durum: ${session.finalState?.phase ?? 'unknown'}`);
  console.log('═══════════════════════════════════════════════');
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { resolve(data.trim()); });
  });
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
