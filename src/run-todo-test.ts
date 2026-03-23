/**
 * Real-World Test: TODO REST API
 * Brief → Agent → Code → Evaluator v2 → Report
 */

import { MemoryLayer } from './memory/index.js';
import { BriefCollector } from './brief/index.js';
import { AgentRunner } from './agent/index.js';
import { Evaluator } from './orchestrator/evaluator.js';
import type { TaskDefinition, OrchestratorConfig } from './types/index.js';

const PROJECT_ROOT = process.cwd();

async function main(): Promise<void> {
  console.log('╔═════════════════════════════════════════════════╗');
  console.log('║   TODO REST API — Full Pipeline Test             ║');
  console.log('╚═════════════════════════════════════════════════╝\n');

  const memory = new MemoryLayer(PROJECT_ROOT);

  // ── STEP 1: Brief ─────────────────────────────────────
  console.log('━━━ STEP 1: Brief ━━━');
  const brief = BriefCollector.create(
    {
      whatToBuild: 'Basit bir TODO REST API (in-memory, express)',
      stack: 'typescript-node',
      successCriteria: [
        'npm test geçmeli',
        'GET /todos çalışmalı',
        'POST /todos çalışmalı',
        'DELETE /todos/:id çalışmalı',
      ],
    },
    {
      protectedFiles: ['MISSION.md'],
      lockedDecisions: [],
      forbiddenDeps: ['fastify', 'koa', 'hapi', 'lodash'],
      breakingChanges: ['Mevcut testler kırılmasın'],
    }
  );
  const collector = new BriefCollector();
  await collector.writeMission(brief, `${PROJECT_ROOT}/MISSION.md`);
  console.log('  ✅ Brief → MISSION.md yazıldı');

  // ── STEP 2: Agent ─────────────────────────────────────
  console.log('\n━━━ STEP 2: Agent — TODO API yaz ━━━');
  const runner = new AgentRunner({
    binaryPath: 'claude.exe',
    workingDirectory: PROJECT_ROOT,
    timeout: 180_000,
    maxDepth: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  const health = await runner.checkHealth();
  console.log(`  Health: ${health.ready ? '✅' : '❌'} ${health.details}`);

  const snapshot = await memory.snapshot();

  const task: TaskDefinition = {
    id: 'T-TODO-001',
    title: 'TODO REST API yaz',
    description: `src/todo/ klasörü altında basit bir TODO REST API oluştur.

Dosyalar:
1. src/todo/server.ts — Express server:
   - GET /todos → tüm todo'ları döndür (JSON array)
   - POST /todos → yeni todo ekle (body: { title: string }), id otomatik artan
   - DELETE /todos/:id → id'ye göre sil, 404 dön yoksa
   - In-memory array kullan, DB yok
   - Export: createApp() fonksiyonu (app dönsün, listen çağırmasın — test için)
   
2. src/todo/index.ts — export

3. tests/todo.test.ts — Vitest + supertest testleri:
   - GET /todos boş liste döner
   - POST /todos yeni todo ekler
   - GET /todos eklenen todo'yu listeler
   - DELETE /todos/:id siler
   - DELETE /todos/999 → 404
   - En az 5 test

KURALLAR:
- express kullan (zaten dependency'de var, yoksa ekle)
- fastify, koa, hapi KULLANMA
- MISSION.md'ye DOKUNMA
- supertest'i devDependency olarak ekle (yoksa npm install --save-dev supertest @types/supertest çalıştır)
- TypeScript strict uyumlu yaz
- Her dosyada 'export' olsun`,
    type: 'code',
    dependencies: [],
    priority: 'high',
    estimatedComplexity: 'moderate',
    acceptanceCriteria: [
      'src/todo/server.ts mevcut',
      'tests/todo.test.ts mevcut ve geçiyor',
      'GET /todos çalışıyor',
      'POST /todos çalışıyor',
      'DELETE /todos/:id çalışıyor',
      'express kullanılmış, fastify/koa/hapi yok',
      'MISSION.md değiştirilmemiş',
    ],
  };

  console.log(`  ⏳ Agent başlatılıyor...\n`);
  const agentResult = await runner.runTask(task, snapshot);

  console.log(`\n  ═ Agent Result ═`);
  console.log(`  Success: ${agentResult.success}`);
  console.log(`  Duration: ${Math.round(agentResult.duration / 1000)}s`);
  console.log(`  Artifacts: [${agentResult.artifacts.join(', ')}]`);
  console.log(`  Output (300ch): ${agentResult.output.slice(0, 300)}`);

  // ── STEP 3: Evaluator ─────────────────────────────────
  console.log('\n━━━ STEP 3: Evaluator v2 ━━━');
  const evalConfig: OrchestratorConfig = {
    projectRoot: PROJECT_ROOT,
    claudeApiKey: '',
    model: 'claude-sonnet-4-20250514',
    maxRetries: 3,
    escalationThreshold: 0.4,
    maxParallelAgents: 3,
    verbose: true,
  };
  const evaluator = new Evaluator(evalConfig);
  const freshSnapshot = await memory.snapshot();
  const evalResult = await evaluator.evaluate(agentResult, freshSnapshot);

  console.log(`\n  Verdict: ${evalResult.verdict}`);
  console.log(`  Quality: ${(evalResult.qualityScore * 100).toFixed(0)}%`);
  console.log(`  Consistency: ${(evalResult.consistencyScore * 100).toFixed(0)}%`);
  console.log(`  Mission: ${(evalResult.missionAlignment * 100).toFixed(0)}%`);

  console.log(`\n  ── Checks ──`);
  for (const c of evalResult.checks) {
    const icon = c.passed ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}${c.duration ? ` (${c.duration}ms)` : ''}${!c.passed && c.output ? ' → ' + c.output.slice(0, 120) : ''}`);
  }

  console.log(`\n  ── Anti-Scope ──`);
  console.log(`  ${evalResult.antiScopeViolations.length === 0 ? '✅ Temiz' : evalResult.antiScopeViolations.map(v => `❌ ${v.detail}`).join('\n  ')}`);

  // ── STEP 4: Decision + Report ─────────────────────────
  const nextId = await memory.getNextDecisionId();
  await memory.appendDecision({
    id: nextId,
    title: 'TODO API entegrasyon testi',
    date: new Date().toISOString(),
    context: 'Gerçek brief ile TODO REST API üretimi ve değerlendirmesi',
    decision: `Verdict: ${evalResult.verdict}. Quality: ${(evalResult.qualityScore * 100).toFixed(0)}%. Checks: ${evalResult.checks.filter(c => c.passed).length}/${evalResult.checks.length}. Anti-scope: ${evalResult.antiScopeViolations.length} ihlal.`,
    rationale: 'Full pipeline kanıtı: Brief→MISSION→Agent→Code→Evaluator',
    alternatives: 'N/A',
    status: 'active',
  });

  const cp = evalResult.checks.filter(c => c.passed).length;
  const ct = evalResult.checks.length;
  console.log(`\n╔═════════════════════════════════════════════════╗`);
  console.log(`║              FINAL REPORT                        ║`);
  console.log(`╠═════════════════════════════════════════════════╣`);
  console.log(`║  Agent:      ${agentResult.success ? '✅' : '❌'} (${Math.round(agentResult.duration / 1000)}s)                           ║`);
  console.log(`║  Verdict:    ${evalResult.verdict.toUpperCase().padEnd(10)}                       ║`);
  console.log(`║  Checks:     ${cp}/${ct} passed                          ║`);
  console.log(`║  Anti-scope: ${evalResult.antiScopeViolations.length === 0 ? '✅ Temiz' : '❌ İhlal'}                          ║`);
  console.log(`║  Quality:    ${(evalResult.qualityScore * 100).toFixed(0)}%                              ║`);
  console.log(`║  Decision:   ${nextId}                             ║`);
  console.log(`╚═════════════════════════════════════════════════╝`);
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
