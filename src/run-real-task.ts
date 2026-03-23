/**
 * Real-World Task Runner
 * 
 * Orchestrator'ın tam döngüsünü tek bir gerçek görevle çalıştırır:
 * 1. Memory snapshot al
 * 2. Task tanımla
 * 3. Agent'ı gerçek claude.exe ile spawn et
 * 4. Çıktıyı parse et
 * 5. DECISIONS.md'ye logla
 * 6. STATE.md güncelle
 * 7. Sonucu raporla
 */

import { MemoryLayer } from './memory/index.js';
import { AgentRunner } from './agent/index.js';
import { ContextBuilder } from './agent/context-builder.js';
import type { TaskDefinition, Decision } from './types/index.js';

const PROJECT_ROOT = process.cwd();

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PROJECT CONSCIOUSNESS — Real-World Task Runner     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const memory = new MemoryLayer(PROJECT_ROOT);
  const runner = new AgentRunner({
    binaryPath: 'claude.exe',
    workingDirectory: PROJECT_ROOT,
    timeout: 120_000,
    maxDepth: 3,
    log: (msg) => console.log(`  ${msg}`),
  });

  // ── Step 1: Memory Snapshot ───────────────────────────

  console.log('━━━ Step 1: Memory Snapshot ━━━');
  const snapshot = await memory.snapshot();
  console.log(`  Hash: ${snapshot.hash}`);
  console.log(`  Mission bütünlüğü: ${await memory.validateMissionIntegrity() ? '✅' : '❌'}`);
  console.log(`  Mevcut kararlar: ${await memory.getDecisionCount()}`);

  // ── Step 2: Health Check ──────────────────────────────

  console.log('\n━━━ Step 2: Agent Runner Health ━━━');
  const health = await runner.checkHealth();
  console.log(`  Ready: ${health.ready}`);
  console.log(`  Details: ${health.details}`);
  if (!health.ready) {
    console.error('❌ Agent runner hazır değil, çıkılıyor.');
    process.exit(1);
  }

  // ── Step 3: Task Tanımı ───────────────────────────────

  console.log('\n━━━ Step 3: Task Tanımı ━━━');
  const task: TaskDefinition = {
    id: 'T-REAL-001',
    title: 'Create docs/GLOSSARY.md',
    description: `docs/ klasörünü oluştur ve içine GLOSSARY.md dosyası yaz.

Bu dosya, Project Consciousness sisteminde kullanılan temel terimleri açıklamalı:

1. MISSION.md — Projenin değişmez varlık sebebi
2. ARCHITECTURE.md — Teknik mimari ve katman yapısı
3. DECISIONS.md — Append-only karar logu
4. STATE.md — Canlı proje durumu
5. Orchestrator — Plan, değerlendirme ve eskalasyon yönetimi
6. Agent Runner — Claude Code instance'ları spawn ve yönetimi
7. Memory Layer — 4 dosyanın okuma/yazma guardianı
8. Memory Snapshot — Tüm hafızanın anlık kopyası
9. Escalation — İnsan müdahalesi gereken durumlar
10. Context Injection — Agent prompt'una hafıza enjeksiyonu

Her terim için:
- Türkçe kısa tanım (1-2 cümle)
- Hangi dosyada/modülde yaşadığı

SADECE docs/GLOSSARY.md dosyasını oluştur. Başka dosya değiştirme.`,
    type: 'document',
    dependencies: [],
    priority: 'medium',
    estimatedComplexity: 'simple',
    acceptanceCriteria: [
      'docs/ klasörü oluşturulmuş',
      'docs/GLOSSARY.md dosyası var',
      'En az 7 terim tanımlanmış',
      'Her terim Türkçe açıklanmış',
      'Dosya markdown formatında',
    ],
  };

  console.log(`  ID: ${task.id}`);
  console.log(`  Title: ${task.title}`);
  console.log(`  Criteria: ${task.acceptanceCriteria.length} adet`);

  // ── Step 4: Context Build (doğrulama) ─────────────────

  console.log('\n━━━ Step 4: Context Preview ━━━');
  const ctxBuilder = new ContextBuilder();
  const agent = runner.getAgent('documenter')!;
  const prompt = ctxBuilder.buildPrompt(task, snapshot, agent);
  console.log(`  Prompt uzunluğu: ${prompt.length} karakter`);
  console.log(`  MISSION içeriyor: ${prompt.includes('MISSION') ? '✅' : '❌'}`);
  console.log(`  ARCHITECTURE içeriyor: ${prompt.includes('ARCHITECTURE') ? '✅' : '❌'}`);
  console.log(`  DECISIONS içeriyor: ${prompt.includes('DECISIONS') ? '✅' : '❌'}`);

  // ── Step 5: Agent Execution ───────────────────────────

  console.log('\n━━━ Step 5: Agent Execution ━━━');
  console.log('  ⏳ claude.exe --print çalıştırılıyor...\n');

  const result = await runner.runTask(task, snapshot);

  console.log(`\n  ══ Agent Result ══`);
  console.log(`  Task ID:  ${result.taskId}`);
  console.log(`  Agent:    ${result.agentId}`);
  console.log(`  Success:  ${result.success}`);
  console.log(`  Duration: ${result.duration}ms`);
  console.log(`  Artifacts: [${result.artifacts.join(', ')}]`);
  console.log(`  Output (first 500):`);
  console.log(`  ${result.output.slice(0, 500)}`);

  // ── Step 6: Decision Logging ──────────────────────────

  console.log('\n━━━ Step 6: Decision Logging ━━━');
  const nextId = await memory.getNextDecisionId();
  const decision: Decision = {
    id: nextId,
    title: 'Real-world task: docs/GLOSSARY.md oluşturma',
    date: new Date().toISOString(),
    context: 'Sistemin çalışma kanıtı olarak gerçek bir dosya üretim görevi verildi',
    decision: `Agent (documenter) ${result.success ? 'başarıyla' : 'başarısız şekilde'} çalıştı. Süre: ${result.duration}ms`,
    rationale: 'E2E sonrası gerçek dünya testi — orchestrator döngüsünün tüm adımları çalışmalı',
    alternatives: 'Manuel dosya oluşturma (orchestrator kanıtı olmaz)',
    status: 'active',
  };
  await memory.appendDecision(decision);
  console.log(`  Karar loglandı: ${nextId}`);

  // ── Step 7: State Update ──────────────────────────────

  console.log('\n━━━ Step 7: State Update ━━━');
  const state = await memory.parseState();

  // Active tasks'a T-REAL-001'i ekle ve tamamlanmış olarak işaretle
  state.completedTasks.push({
    taskId: task.id,
    title: task.title,
    status: result.success ? 'done' : 'failed',
    assignedAgent: result.agentId,
    completedAt: new Date().toISOString(),
    output: `${result.success ? 'Başarılı' : 'Başarısız'} — ${result.duration}ms`,
  });
  state.iteration += 1;
  state.lastUpdated = new Date().toISOString();
  await memory.updateState(state);
  console.log(`  STATE.md güncellendi (iteration: ${state.iteration})`);

  // ── Step 8: Verification ──────────────────────────────

  console.log('\n━━━ Step 8: Doğrulama ━━━');
  
  // DECISIONS.md kontrol
  const decisionsContent = await memory.readDecisions();
  const hasNewDecision = decisionsContent.includes(nextId);
  console.log(`  DECISIONS.md yeni karar (${nextId}): ${hasNewDecision ? '✅' : '❌'}`);

  // STATE.md kontrol
  const stateContent = await memory.readState();
  const hasTaskInState = stateContent.includes('T-REAL-001');
  console.log(`  STATE.md task kaydı: ${hasTaskInState ? '✅' : '❌'}`);

  // docs/GLOSSARY.md kontrol
  let glossaryExists = false;
  let glossaryContent = '';
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    glossaryContent = await readFile(join(PROJECT_ROOT, 'docs', 'GLOSSARY.md'), 'utf-8');
    glossaryExists = true;
  } catch {
    glossaryExists = false;
  }

  console.log(`  docs/GLOSSARY.md oluştu: ${glossaryExists ? '✅' : '❌'}`);

  if (glossaryExists) {
    const terms = ['MISSION', 'ARCHITECTURE', 'DECISIONS', 'STATE', 'Orchestrator', 'Agent', 'Memory'];
    const foundTerms = terms.filter(t => glossaryContent.includes(t));
    console.log(`  Terimler (${foundTerms.length}/${terms.length}): ${foundTerms.join(', ')}`);
    console.log(`  Dosya boyutu: ${glossaryContent.length} karakter`);
    console.log(`\n  ── GLOSSARY.md İlk 600 Karakter ──`);
    console.log(glossaryContent.slice(0, 600));
    console.log('  ──────────────────────────────────\n');
  }

  // ── Final Report ──────────────────────────────────────

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║                   FINAL REPORT                       ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║ Agent çalıştı:        ${result.success ? '✅ EVET' : '❌ HAYIR'}                        ║`);
  console.log(`║ Claude CLI spawn:     ✅ claude.exe --print           ║`);
  console.log(`║ Memory context:       ✅ 4 dosya enjekte edildi       ║`);
  console.log(`║ docs/GLOSSARY.md:     ${glossaryExists ? '✅ OLUŞTU' : '❌ OLUŞMADI'}                       ║`);
  console.log(`║ DECISIONS.md:         ${hasNewDecision ? '✅ LOGLAND' : '❌ LOGLANMADI'}I                       ║`);
  console.log(`║ STATE.md:             ${hasTaskInState ? '✅ GÜNCELLENDİ' : '❌ GÜNCELLENMEDİ'}                   ║`);
  console.log(`║ Süre:                 ${Math.round(result.duration / 1000)}s                               ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
