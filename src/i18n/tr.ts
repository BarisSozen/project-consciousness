/**
 * Türkçe locale strings
 */

import type { LocaleStrings } from './types.js';

export const tr: LocaleStrings = {
  // ── Orchestrator ──────────────────────────────────
  orchestratorStarting: '🚀 Orkestrasyon başlıyor...',
  memoryValidated: '✅ Hafıza bütünlüğü doğrulandı',
  memorySnapshotTaken: '📸 Hafıza snapshot alındı',
  planCreating: '📋 Plan oluşturuluyor...',
  planReady: (taskCount, stepCount) => `✅ Plan hazır: ${taskCount} task, ${stepCount} adım`,
  agentRunnerHealth: (ready, detail) => `🏥 Agent runner: ${ready ? '✅' : '❌'} ${detail}`,
  phaseTransition: (phase) => `📌 Faz geçişi: ${phase}`,
  stepHeader: (current, total, ids) => `\n── Adım ${current}/${total}: [${ids}] ──`,
  taskStarting: (id) => `  ⚡ Task ${id} başlatılıyor...`,
  taskResult: (id, success, duration) => `  ${success ? '✅' : '❌'} Task ${id}: ${success ? 'başarılı' : 'başarısız'} (${duration}ms)`,
  evalResult: (verdict, consistency, quality, mission) => `  📊 Değerlendirme: ${verdict} (tutarlılık: ${consistency}, kalite: ${quality}, misyon: ${mission})`,
  accepted: '  ✅ Kabul edildi.',
  reviseNeeded: '  🔄 Revize gerekli.',
  escalationNeeded: '  🚨 Eskalasyon gerekli!',
  allTasksComplete: '\n🏁 Tüm task\'lar tamamlandı, review aşamasında.',
  sessionComplete: (id) => `✅ Session tamamlandı: ${id}`,
  totalSteps: (count) => `📊 Toplam adım: ${count}`,
  finalPhase: (phase) => `📌 Son durum: ${phase}`,

  // ── Agent ─────────────────────────────────────────
  agentStarting: (agentId, taskId) => `  🤖 Agent [${agentId}] task ${taskId} için başlatılıyor...`,
  promptReady: (length) => `  📝 Prompt hazır (${length} karakter)`,
  agentTimeout: (duration) => `  ⏰ Agent timeout! (${duration}ms)`,
  agentComplete: (agentId, duration) => `  Agent [${agentId}] tamamlandı (${duration}ms)`,
  agentError: (agentId, error) => `  💥 Agent [${agentId}] hata: ${error}`,
  parallelBatch: (batchNum, total, ids) => `  📦 Batch ${batchNum}/${total}: [${ids}]`,
  batchResult: (batchNum, succeeded, total) => `  📊 Batch ${batchNum}: ${succeeded}/${total} başarılı`,

  // ── Evaluator ─────────────────────────────────────
  checksResult: (passed, total) => `Kontroller: ${passed}/${total} geçti`,
  antiScopeViolation: (detail) => `⚠️ Anti-scope ihlalleri: ${detail}`,
  protectedFileViolation: (file) => `Agent yasaklı dosyaya dokundu: ${file}`,
  forbiddenDepViolation: (dep) => `Yasaklı bağımlılık tespit edildi: ${dep}`,
  breakingChangeViolation: (bc) => `Kabul edilemez kırılma tespit edildi: ${bc}`,

  // ── Escalator ─────────────────────────────────────
  escalationTitle: (taskId) => `ESKALASYON — Task: ${taskId}`,
  escalationReason: 'Sebep',
  escalationContext: 'Bağlam',
  escalationOptions: 'Seçenekler',
  escalationOptionContinue: 'Devam et — bu çıktıyı kabul et ve ilerle',
  escalationOptionSkip: 'Atla — bu task\'ı atla, sonrakine geç',
  escalationOptionStop: 'Durdur — projeyi duraklat',
  escalationPrompt: '\n  Seçiminiz (1=devam / 2=atla / 3=durdur): ',
  userResponse: (action) => `  👤 Kullanıcı yanıtı: ${action}`,

  // ── Brief ─────────────────────────────────────────
  briefQuestion: '📋 Ne yapmak istiyorsun?',
  briefAnalyzing: '🔍 Analiz ediliyor...',
  briefSummaryTitle: 'Plan Özeti',
  briefConfirm: 'Devam edelim mi? (e/h)',

  // ── Architect ─────────────────────────────────────
  architectTitle: 'ARCHITECT — Mimari Kararlar',
  authQuestion: '🔐 Auth stratejisi?',
  databaseQuestion: '🗄️  Database?',
  apiStyleQuestion: '🌐 API stili?',
  frontendQuestion: '🖥️  Frontend?',
  deploymentQuestion: '🚀 Deployment hedefi?',

  // ── Memory ────────────────────────────────────────
  missionHeading: '# MISSION',
  missionWhyWeExist: '## Neden Varız',
  missionWhatWeBuilt: '## Ne İnşa Ediyoruz',
  missionSuccessCriteria: '## Başarı Tanımı',

  // ── Agent Personas ────────────────────────────────
  coderPersona: `Sen deneyimli bir yazılım mühendisisin.
Görevin: Verilen task'ı implement et, clean code yaz, testlerden geç.
KURALLAR:
- MISSION.md'deki amaçla %100 uyumlu kod yaz
- ARCHITECTURE.md'deki mimari kararlara uy
- DECISIONS.md'deki geçmiş kararlarla çelişme
- Sadece tanımlanan task'ı yap, kapsamı aşma
- Her dosya değişikliğini açıkla`,

  reviewerPersona: `Sen bir kod review uzmanısın.
Görevin: Verilen kodu MISSION, ARCHITECTURE ve DECISIONS'a karşı denetle.
KONTROL LİSTESİ:
- Misyondan sapma var mı?
- Mimari ihlal var mı?
- Önceki kararlarla çelişki var mı?
- Kapsam dışına çıkılmış mı?
- Kod kalitesi yeterli mi?
Her bulguyu [PASS/WARN/FAIL] etiketiyle raporla.`,

  testerPersona: `Sen bir QA mühendisisin.
Görevin: Verilen kod için kapsamlı test yaz ve çalıştır.
KURALLAR:
- Edge case'leri kapsa
- Vitest framework kullan
- Her test neden var açıkla
- Coverage raporla`,

  documenterPersona: `Sen bir teknik yazar/dokumentasyon uzmanısın.
Görevin: Kodu, kararları ve mimariyi dokümante et.
KURALLAR:
- İnsan okunabilir markdown yaz
- Örnekler ekle
- ARCHITECTURE.md ile tutarlı ol`,

  plannerSystemPrompt: `Sen bir proje planlama uzmanısın.
Görevin: verilen brief ve mevcut proje hafızasını okuyarak bir task planı oluşturmak.

KURALLAR:
1. Her task atomik ve bağımsız olmalı (mümkün olduğunca)
2. Bağımlılıklar açıkça belirtilmeli
3. Paralel çalışabilecek task'lar gruplanmalı
4. Her task'ın kabul kriterleri net olmalı
5. Complexity tahmini gerçekçi olmalı
6. MISSION.md'deki amaçla %100 uyumlu olmalı

ÇIKTI FORMATI: JSON (TaskPlan tipinde)`,

  evaluatorSystemPrompt: `Sen bir kalite ve tutarlılık denetçisisin.
Görevin: Bir agent'ın çıktısını projenin hafızasına karşı değerlendirmek.

Skorlar (0-1): consistencyScore, qualityScore, missionAlignment
Sorun kategorileri: mission-drift, architecture-violation, decision-conflict, scope-creep

Karar: accept (>0.7), revise (0.4-0.7), escalate (<0.4 veya critical)
Çıktı: JSON (EvaluationResult)`,

  // ── Context Builder ───────────────────────────────
  memoryContextTitle: 'PROJE HAFIZASI — Bu bağlam her şeyin üstündedir',
  missionLabel: 'MISSION (ASLA UNUTMA — Bu projenin varlık sebebi)',
  architectureLabel: 'ARCHITECTURE (Mimari kararlar — bunlara uy)',
  decisionsLabel: 'DECISIONS (Geçmiş kararlar — bunlarla çelişme)',
  stateLabel: 'STATE (Şu anki durum)',
  taskSection: 'GÖREV',
  outputFormatSection: 'ÇIKTI FORMATI',
  scopeWarning: '⚠️ KAPSAM UYARISI: Sadece yukarıdaki kabul kriterlerini karşıla. Ekstra özellik ekleme, scope creep yapma.',

  // ── General ───────────────────────────────────────
  apiKeyRequired: (keyName) => `❌ ${keyName} environment variable gerekli`,
  briefRequired: '❌ Brief gerekli. Kullanım: npx tsx src/index.ts "brief metni"',
  missionIntegrityFailed: 'MISSION.md integrity check failed — temel bölümler eksik',

  // ── Retry ─────────────────────────────────────────
  retryHeader: (attempt, max) => `⚠️ RETRY ${attempt}/${max} — ÖNCEKİ DENEME BAŞARISIZ`,
  retryFeedback: 'Geri bildirim',
  retryIssues: 'Tespit edilen sorunlar',
  retryScores: (c, q, m) => `Skorlar: tutarlılık ${(c * 100).toFixed(0)}%, kalite ${(q * 100).toFixed(0)}%, misyon ${(m * 100).toFixed(0)}%`,
  retryFixInstruction: 'BU SORUNLARI DÜZELT ve tekrar dene.',
};
