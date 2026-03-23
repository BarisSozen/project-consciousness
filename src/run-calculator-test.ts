/**
 * Entegrasyon Testi: Brief → Agent → Calculator → Evaluator v2
 * 
 * 1. BriefCollector.create() ile brief oluştur
 * 2. MISSION.md'ye yaz
 * 3. Agent'a hesap makinesi yaptır
 * 4. Evaluator v2 ile gerçek kontrolleri çalıştır
 * 5. Raporla
 */

import { MemoryLayer } from './memory/index.js';
import { BriefCollector } from './brief/index.js';
import { AgentRunner } from './agent/index.js';
import { Evaluator } from './orchestrator/evaluator.js';
import type { TaskDefinition, Decision, OrchestratorConfig } from './types/index.js';

const PROJECT_ROOT = process.cwd();

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  ENTEGRASYON TESTİ: Brief → Agent → Calculator → Eval    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const memory = new MemoryLayer(PROJECT_ROOT);

  // ═══════════════════════════════════════════════════════
  // STEP 1: Brief oluştur
  // ═══════════════════════════════════════════════════════
  console.log('━━━ STEP 1: Brief Oluştur ━━━');
  
  const brief = BriefCollector.create(
    {
      whatToBuild: 'Basit bir Node.js CLI hesap makinesi',
      stack: 'typescript-node',
      successCriteria: [
        'npm test geçmeli',
        'Toplama çalışmalı',
        'Çıkarma çalışmalı',
        'Çarpma çalışmalı',
        'Bölme çalışmalı',
      ],
    },
    {
      protectedFiles: ['MISSION.md', 'ARCHITECTURE.md'],
      lockedDecisions: ['D001 Dosya tabanlı hafıza sistemi'],
      forbiddenDeps: ['lodash'],
      breakingChanges: ['Mevcut testler kırılmasın'],
    }
  );

  console.log(`  ✅ Brief oluşturuldu`);
  console.log(`  Stack: ${brief.scope.stack}`);
  console.log(`  Protected: ${brief.antiScope.protectedFiles.join(', ')}`);
  console.log(`  Forbidden: ${brief.antiScope.forbiddenDeps.join(', ')}`);

  // ═══════════════════════════════════════════════════════
  // STEP 2: MISSION.md'ye yaz
  // ═══════════════════════════════════════════════════════
  console.log('\n━━━ STEP 2: MISSION.md Güncelle ━━━');
  
  const collector = new BriefCollector();
  const missionPath = `${PROJECT_ROOT}/MISSION.md`;
  await collector.writeMission(brief, missionPath);
  
  // Doğrula
  const missionContent = await memory.readMission();
  console.log(`  SCOPE var: ${missionContent.includes('## SCOPE') ? '✅' : '❌'}`);
  console.log(`  ANTI-SCOPE var: ${missionContent.includes('## ANTI-SCOPE') ? '✅' : '❌'}`);
  console.log(`  SUCCESS CRITERIA var: ${missionContent.includes('## SUCCESS CRITERIA') ? '✅' : '❌'}`);
  console.log(`  lodash yasaklı: ${missionContent.includes('lodash') ? '✅' : '❌'}`);

  // ═══════════════════════════════════════════════════════
  // STEP 3: Agent'a hesap makinesi yaptır
  // ═══════════════════════════════════════════════════════
  console.log('\n━━━ STEP 3: Agent — Hesap Makinesi Yaz ━━━');

  const runner = new AgentRunner({
    binaryPath: 'claude.exe',
    workingDirectory: PROJECT_ROOT,
    timeout: 180_000,
    maxDepth: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  const health = await runner.checkHealth();
  console.log(`  Agent health: ${health.ready ? '✅' : '❌'} ${health.details}`);

  const snapshot = await memory.snapshot();

  const task: TaskDefinition = {
    id: 'T-CALC-001',
    title: 'Hesap makinesi yaz',
    description: `src/calculator/ klasörü altında basit bir hesap makinesi modülü oluştur.

Dosyalar:
1. src/calculator/calculator.ts — Calculator class:
   - add(a: number, b: number): number
   - subtract(a: number, b: number): number
   - multiply(a: number, b: number): number
   - divide(a: number, b: number): number (0'a bölme Error fırlatsın)
   
2. src/calculator/index.ts — export

3. tests/calculator.test.ts — Vitest testleri:
   - Her operasyon için en az 1 test
   - 0'a bölme testi
   - Negatif sayı testi

KURALLAR:
- lodash veya başka harici kütüphane KULLANMA
- MISSION.md ve ARCHITECTURE.md dosyalarına DOKUNMA
- Sadece src/calculator/ ve tests/calculator.test.ts oluştur
- TypeScript strict uyumlu yaz`,
    type: 'code',
    dependencies: [],
    priority: 'high',
    estimatedComplexity: 'simple',
    acceptanceCriteria: [
      'src/calculator/calculator.ts mevcut ve derleniyor',
      'tests/calculator.test.ts mevcut ve geçiyor',
      'Toplama, çıkarma, çarpma, bölme çalışıyor',
      '0a bölme hata fırlatıyor',
      'lodash kullanılmamış',
      'MISSION.md ve ARCHITECTURE.md değiştirilmemiş',
    ],
  };

  console.log(`  ⏳ Agent başlatılıyor (task: ${task.id})...\n`);
  const agentResult = await runner.runTask(task, snapshot);

  console.log(`\n  ══ Agent Result ══`);
  console.log(`  Success: ${agentResult.success}`);
  console.log(`  Duration: ${Math.round(agentResult.duration / 1000)}s`);
  console.log(`  Artifacts: [${agentResult.artifacts.join(', ')}]`);
  console.log(`  Output (first 500):`);
  console.log(`  ${agentResult.output.slice(0, 500)}`);

  // ═══════════════════════════════════════════════════════
  // STEP 4: Evaluator v2 çalıştır
  // ═══════════════════════════════════════════════════════
  console.log('\n━━━ STEP 4: Evaluator v2 — Gerçek Kontroller ━━━');

  const evalConfig: OrchestratorConfig = {
    projectRoot: PROJECT_ROOT,
    claudeApiKey: '',  // LLM yok, sadece gerçek kontroller
    model: 'claude-sonnet-4-20250514',
    maxRetries: 3,
    escalationThreshold: 0.4,
    maxParallelAgents: 3,
    verbose: true,
  };

  const evaluator = new Evaluator(evalConfig);

  // Güncel memory snapshot (agent'ın değişiklikleri yansısın)
  const freshSnapshot = await memory.snapshot();
  
  // Stack tespiti
  const stack = await evaluator.detectStack(freshSnapshot);
  console.log(`  Stack tespit: ${stack}`);

  // Tam değerlendirme
  const evalResult = await evaluator.evaluate(agentResult, freshSnapshot);

  console.log(`\n  ══ Evaluation Result ══`);
  console.log(`  Verdict: ${evalResult.verdict}`);
  console.log(`  Consistency: ${(evalResult.consistencyScore * 100).toFixed(0)}%`);
  console.log(`  Quality: ${(evalResult.qualityScore * 100).toFixed(0)}%`);
  console.log(`  Mission Alignment: ${(evalResult.missionAlignment * 100).toFixed(0)}%`);
  console.log(`  Stack Detected: ${evalResult.stackDetected}`);
  
  console.log(`\n  ── Checks ──`);
  for (const check of evalResult.checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.name}${check.duration ? ` (${check.duration}ms)` : ''}`);
    if (!check.passed && check.output) {
      console.log(`     → ${check.output.slice(0, 150)}`);
    }
  }

  console.log(`\n  ── Anti-Scope ──`);
  if (evalResult.antiScopeViolations.length === 0) {
    console.log(`  ✅ İhlal yok`);
  } else {
    for (const v of evalResult.antiScopeViolations) {
      console.log(`  ❌ [${v.type}] ${v.detail}`);
    }
  }

  console.log(`\n  ── Issues ──`);
  if (evalResult.issues.length === 0) {
    console.log(`  ✅ Sorun yok`);
  } else {
    for (const issue of evalResult.issues) {
      const icon = issue.severity === 'critical' ? '🚨' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`  ${icon} [${issue.category}] ${issue.description}`);
    }
  }

  console.log(`\n  Feedback: ${evalResult.feedback}`);

  // ═══════════════════════════════════════════════════════
  // STEP 5: DECISIONS.md logla
  // ═══════════════════════════════════════════════════════
  console.log('\n━━━ STEP 5: Decision Log ━━━');
  const nextId = await memory.getNextDecisionId();
  const decision: Decision = {
    id: nextId,
    title: `Calculator entegrasyon testi — Evaluator v2`,
    date: new Date().toISOString(),
    context: 'Brief→Agent→Calculator→Evaluator tam döngü testi',
    decision: `Verdict: ${evalResult.verdict}. Quality: ${(evalResult.qualityScore * 100).toFixed(0)}%. Checks: ${evalResult.checks.filter(c => c.passed).length}/${evalResult.checks.length}. Anti-scope: ${evalResult.antiScopeViolations.length} ihlal.`,
    rationale: 'Sistemin gerçek bir kod üretim + değerlendirme döngüsünü kanıtlaması',
    alternatives: 'Manuel test (otomasyon kanıtı olmaz)',
    status: 'active',
  };
  await memory.appendDecision(decision);
  console.log(`  Karar: ${nextId}`);

  // ═══════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════
  const checksPass = evalResult.checks.filter(c => c.passed).length;
  const checksTotal = evalResult.checks.length;
  const violations = evalResult.antiScopeViolations.length;

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL REPORT                           ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Brief oluşturuldu:     ✅                                ║`);
  console.log(`║  MISSION.md güncellendi: ✅                                ║`);
  console.log(`║  Agent çalıştı:         ${agentResult.success ? '✅' : '❌'} (${Math.round(agentResult.duration / 1000)}s)                         ║`);
  console.log(`║  Evaluator verdict:     ${evalResult.verdict.toUpperCase().padEnd(10)}                        ║`);
  console.log(`║  Checks:                ${checksPass}/${checksTotal} passed                        ║`);
  console.log(`║  Anti-scope:            ${violations === 0 ? '✅ Temiz' : `❌ ${violations} ihlal`}                         ║`);
  console.log(`║  Quality:               ${(evalResult.qualityScore * 100).toFixed(0)}%                              ║`);
  console.log(`║  Consistency:           ${(evalResult.consistencyScore * 100).toFixed(0)}%                              ║`);
  console.log(`║  Mission:               ${(evalResult.missionAlignment * 100).toFixed(0)}%                              ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
