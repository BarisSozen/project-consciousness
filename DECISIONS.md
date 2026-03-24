# DECISIONS — Project Consciousness

> Append-only log. Kararlar asla silinmez, sadece superseded olabilir.

---

## D001 — Dosya Tabanlı Hafıza Sistemi

- **Tarih**: 2026-03-23T23:50:00+03:00
- **Bağlam**: Multi-agent sistemde hafıza kaybını önlemek için bir persistence mekanizması gerekiyor
- **Karar**: 4 markdown dosyası ile dosya tabanlı hafıza sistemi kullanılacak
- **Gerekçe**: Sadelik, okunabilirlik, DB bağımlılığı yok, git ile versiyonlanabilir, insan tarafından doğrudan okunabilir
- **Alternatifler**: SQLite, Redis, JSON dosyaları, vector DB
- **Durum**: active

---

## D002 — TypeScript + Node.js Stack

- **Tarih**: 2026-03-23T23:50:00+03:00
- **Bağlam**: Orchestrator ve agent runner için dil/runtime seçimi
- **Karar**: TypeScript + Node.js
- **Gerekçe**: Type safety, Claude SDK mevcut, async/await doğal, GSD-2 ekosistemi ile uyumlu
- **Alternatifler**: Python, Go, Rust
- **Durum**: active

---

## D003 — GSD-2 Üzerine Katman

- **Tarih**: 2026-03-23T23:50:00+03:00
- **Bağlam**: Mevcut GSD-2 altyapısı ile ilişki tanımlanmalı
- **Karar**: GSD-2'yi replace etmek yerine üstüne oturan bir orchestration katmanı
- **Gerekçe**: Kullanıcı zaten GSD-2 kullanıyor, mevcut workflow'u bozmamak önemli, subagent mekanizması kullanılabilir
- **Alternatifler**: Standalone sistem, GSD-2 fork'u
- **Durum**: active

---

## D004 — Claude API Orchestrator İçin

- **Tarih**: 2026-03-23T23:50:00+03:00
- **Bağlam**: Orchestrator'ın reasoning yapması için LLM gerekiyor
- **Karar**: Claude API kullanılacak (orchestrator reasoning için), Claude Code (agent execution için)
- **Gerekçe**: Orchestrator hafif ve hızlı olmalı (API), agent'lar tam yetenekli olmalı (Claude Code)
- **Alternatifler**: Her ikisi için Claude Code, her ikisi için API
- **Durum**: active

---

## D005 — Agent Runner: Claude CLI --print Modu

- **Tarih**: 2026-03-24T00:20:00+03:00
- **Bağlam**: Agent'ların Claude Code ile nasıl iletişim kuracağının belirlenmesi (T003)
- **Karar**: `claude --print` ile child process spawn, prompt stdin/args üzerinden, çıktı stdout parse
- **Gerekçe**: Non-interactive mod en güvenli ve parse edilebilir. Verbose flag reasoning içerir. GSD subagent'tan bağımsız ama uyumlu.
- **Alternatifler**: Claude API direkt kullanımı (agent'lar dosya sistemi erişimine ihtiyaç duyar), GSD subagent SDK entegrasyonu (tight coupling)
- **Durum**: active

---

## D006 — Agent Depth Protection

- **Tarih**: 2026-03-24T00:20:00+03:00
- **Bağlam**: Agent'ın kendi içinde subagent spawn etmesi sonsuz döngüye yol açabilir
- **Karar**: PC_AGENT_DEPTH env var ile max 3 seviye derinlik koruması
- **Gerekçe**: Basit, env var tabanlı, her spawn'da depth artar, health check'te kontrol edilir
- **Alternatifler**: Process tree analizi (karmaşık), token bütçesi (ölçüm zorluğu)
- **Durum**: active

---

## D007 — Memory-Aware Context Injection

- **Tarih**: 2026-03-24T00:20:00+03:00
- **Bağlam**: Agent'lara hafıza nasıl enjekte edilecek (T003)
- **Karar**: Her agent prompt'una 4 hafıza dosyasının tam içeriği + agent persona + task detayı + çıktı formatı dahil edilir. 30K karakter üstünde compact mod aktif olur.
- **Gerekçe**: Agent her çağrıda tam bağlama sahip olur, hafıza kaybı imkansız. Compact mod token bütçesini korur.
- **Alternatifler**: Sadece ilgili bölümleri göndermek (bağlam kaybı riski), RAG tabanlı retrieval (karmaşıklık)
- **Durum**: active

---

## D008 — E2E: stdin ignore + --print modu yeterli

- **Tarih**: 2026-03-24T00:31:00+03:00
- **Bağlam**: claude CLI stdin bekleme uyarısı ve --verbose flag sorunları (T004 E2E)
- **Karar**: stdio stdin'i `ignore` olarak ayarla, prompt tamamen args üzerinden gönderilir. --verbose kaldırıldı (gereksiz, çıktıyı kirletiyor).
- **Gerekçe**: stdin ignore → uyarı yok, daha temiz process lifecycle. --print tek başına yeterli.
- **Alternatifler**: stdin pipe + explicit close (race condition riski), --verbose tutma (parse zorluğu)
- **Durum**: active

---

## D009 — Real-world task: docs/GLOSSARY.md oluşturma

- **Tarih**: 2026-03-23T21:39:02.621Z
- **Bağlam**: Sistemin çalışma kanıtı olarak gerçek bir dosya üretim görevi verildi
- **Karar**: Agent (documenter) başarısız şekilde çalıştı. Süre: 61ms
- **Gerekçe**: E2E sonrası gerçek dünya testi — orchestrator döngüsünün tüm adımları çalışmalı
- **Alternatifler**: Manuel dosya oluşturma (orchestrator kanıtı olmaz)
- **Durum**: active

---

## D010 — Real-world task: docs/GLOSSARY.md oluşturma

- **Tarih**: 2026-03-23T21:42:14.485Z
- **Bağlam**: Sistemin çalışma kanıtı olarak gerçek bir dosya üretim görevi verildi
- **Karar**: Agent (documenter) başarıyla çalıştı. Süre: 101236ms
- **Gerekçe**: E2E sonrası gerçek dünya testi — orchestrator döngüsünün tüm adımları çalışmalı
- **Alternatifler**: Manuel dosya oluşturma (orchestrator kanıtı olmaz)
- **Durum**: active

---

## D011 — Real-world task: docs/GLOSSARY.md oluşturma

- **Tarih**: 2026-03-23T21:47:48.098Z
- **Bağlam**: Sistemin çalışma kanıtı olarak gerçek bir dosya üretim görevi verildi
- **Karar**: Agent (documenter) başarıyla çalıştı. Süre: 96559ms
- **Gerekçe**: E2E sonrası gerçek dünya testi — orchestrator döngüsünün tüm adımları çalışmalı
- **Alternatifler**: Manuel dosya oluşturma (orchestrator kanıtı olmaz)
- **Durum**: active

---

## D012 — BriefCollector: SCOPE / ANTI-SCOPE Yapısı

- **Tarih**: 2026-03-24T01:05:00+03:00
- **Bağlam**: Kullanıcıdan yapılandırılmış brief toplama ve MISSION.md'ye yazma
- **Karar**: MISSION.md'ye ## SCOPE, ## ANTI-SCOPE, ## SUCCESS CRITERIA bölümleri eklenir. Anti-scope: protectedFiles, lockedDecisions, forbiddenDeps, breakingChanges.
- **Gerekçe**: Agent'ların ne yapmaması gerektiğini bilmesi misyon kadar önemli. Dosya tabanlı (D001 ile uyumlu), insan okunabilir, parse edilebilir.
- **Alternatifler**: Ayrı BRIEF.md dosyası (dağınıklık), JSON config (insan okunamaz)
- **Durum**: active

---

## D013 — Evaluator v2: Gerçek Kontroller + Anti-Scope

- **Tarih**: 2026-03-24T01:05:00+03:00
- **Bağlam**: Agent çıktısını LLM'e sormak yerine gerçek komutlarla doğrulama
- **Karar**: Stack-aware otomatik kontroller (tsc/npm test/pytest/go build) + MISSION.md'deki ANTI-SCOPE parse + dosya varlık kontrolü. LLM opsiyonel.
- **Gerekçe**: Gerçek kontroller yalan söyleyemez. Anti-scope kritik ihlaller için otomatik FAIL.
- **Alternatifler**: Sadece LLM değerlendirme (hallucination riski), sadece dosya kontrolü (kalite ölçülmez)
- **Durum**: active

---

## D014 — Calculator entegrasyon testi — Evaluator v2

- **Tarih**: 2026-03-23T22:13:10.546Z
- **Bağlam**: Brief→Agent→Calculator→Evaluator tam döngü testi
- **Karar**: Verdict: escalate. Quality: 33%. Checks: 5/7. Anti-scope: 0 ihlal.
- **Gerekçe**: Sistemin gerçek bir kod üretim + değerlendirme döngüsünü kanıtlaması
- **Alternatifler**: Manuel test (otomasyon kanıtı olmaz)
- **Durum**: active

---

## D015 — Retry Loop + Escalation: Gerçek Kullanıcı Etkileşimi

- **Tarih**: 2026-03-24T01:25:00+03:00
- **Bağlam**: Agent başarısız olduğunda otomatik retry ve insan müdahalesi (T005)
- **Karar**: Max 3 retry, her retry'da feedback chain prompt'a eklenir. 3 retry sonrası Escalator readline ile kullanıcıya sorar (devam/atla/durdur). Test injection için setAskFn().
- **Gerekçe**: Retry ile küçük hataları otomatik düzelt, büyük sorunlarda insana sor. Fail-safe ilkesi (D001 tasarım ilkeleri).
- **Alternatifler**: Sonsuz retry (tehlikeli), her hata direkt eskalasyon (gereksiz müdahale), sadece log (sessiz hata)
- **Durum**: active

---

## D016 — TODO API entegrasyon testi

- **Tarih**: 2026-03-23T22:30:36.365Z
- **Bağlam**: Gerçek brief ile TODO REST API üretimi ve değerlendirmesi
- **Karar**: Verdict: revise. Quality: 67%. Checks: 6/7. Anti-scope: 0 ihlal.
- **Gerekçe**: Full pipeline kanıtı: Brief→MISSION→Agent→Code→Evaluator
- **Alternatifler**: N/A
- **Durum**: active

---

## D017 — README.md: Açık Kaynak Developer-Oriented Dokümantasyon

- **Tarih**: 2026-03-24T01:42:00+03:00
- **Bağlam**: GitHub'a açık kaynak olarak yayınlanıyor, developer hedef kitle
- **Karar**: Tam README: ne/neden/nasıl, ASCII akış diyagramı, kurulum, kullanım, karşılaştırma tablosu, katkı kuralları, MIT lisans
- **Gerekçe**: İlk izlenim README'den oluşur. Net açıklama + çalışan örnekler + tasarım ilkeleri
- **Alternatifler**: Minimal README (bilgi eksik), wiki (erişim zor)
- **Durum**: active

---

## D018 — Hafıza Optimizasyonu: summarizeDecisions + compressState

- **Tarih**: 2026-03-24T01:42:00+03:00
- **Bağlam**: DECISIONS.md büyüdükçe her agent prompt'u şişiyor (D007 context injection ile çelişki)
- **Karar**: optimizedSnapshot(): son 10 karar tam, eskiler tek satır özet. Completed tasks 5'ten fazlaysa sadece son 5 göster. 50 karar + 30 task → %68.8 boyut azaltma.
- **Gerekçe**: D007'deki 30K compact mode'u reactive (aşınca kısalt). Bu proactive (her zaman optimize). İkisi birlikte çalışır.
- **Alternatifler**: RAG (karmaşık), LLM ile özetleme (maliyet + latency), sadece son N karar (bağlam kaybı)
- **Durum**: active

---

## D019 — CLI Dağıtım: pc init/run/status/log

- **Tarih**: 2026-03-24T01:55:00+03:00
- **Bağlam**: Projenin npx/global install/clone ile çalışması gerekiyor
- **Karar**: bin/pc.ts CLI → pc init (interaktif brief), pc run (orchestrator), pc status (STATE.md), pc log (DECISIONS.md). package.json: bin, exports, files, prepublishOnly.
- **Gerekçe**: 3 dağıtım modu: npx (zero install), npm -g (global), git clone. Hepsi aynı CLI.
- **Alternatifler**: Sadece programmatic API (UX yok), ayrı CLI paketi (dağınıklık)
- **Durum**: active

---

## D020 — ArchitectAgent: Kodlama Öncesi Mimari Kararlar

- **Tarih**: 2026-03-24T02:22:00+03:00
- **Bağlam**: Agent'lar kod yazmaya başlamadan önce auth/DB/API/frontend/deployment kararları net olmalı
- **Karar**: ArchitectAgent interaktif CLI ile 5 soru sorar, cevapları ARCHITECTURE.md'ye yazar. runWithDefaults() test/CI modu. Kararlar parse edilebilir format.
- **Gerekçe**: Mimari kararlar bir kez alınır, tüm agent'lar okur. Memory-First ilkesi (D001).
- **Alternatifler**: LLM'e sorma (hallucination), her agent kendisi karar versin (tutarsızlık)
- **Durum**: active

---

## D021 — Milestone Sistemi: Aşamalı Planlama

- **Tarih**: 2026-03-24T02:22:00+03:00
- **Bağlam**: Tek büyük plan yerine bağımlılık sırası olan milestone'lar gerekiyor
- **Karar**: MilestoneManager brief + architecture'dan M01-M0N milestone zinciri üretir. dependsOn ile sıralama, STATE.md'ye milestone durumu yazılır.
- **Gerekçe**: Foundation → Auth → API → Frontend → Integration doğal akış. Her milestone bağımsız test edilebilir.
- **Alternatifler**: Düz task listesi (bağımlılık kaybı), LLM planlama (tutarsız)
- **Durum**: active

---

## D022 — DependencyGraph: Topological Sort + Paralel Gruplama

- **Tarih**: 2026-03-24T02:22:00+03:00
- **Bağlam**: Task'lar arası bağımlılık yönetimi ve paralel çalışma optimizasyonu
- **Karar**: Kahn's algorithm ile topological sort. Cycle detection (DFS). getReadyTasks() ile dinamik paralel gruplama.
- **Gerekçe**: Doğru sıralama + maksimum paralellik. Cycle'lar erken tespit edilir.
- **Alternatifler**: Sıralı çalıştırma (yavaş), LLM sıralama (güvenilmez)
- **Durum**: active

---

## D023 — Crash Recovery: Checkpoint + Resume

- **Tarih**: 2026-03-24T02:22:00+03:00
- **Bağlam**: Uzun orchestration session'ları çökebilir, kaldığı yerden devam gerekli
- **Karar**: .pc-checkpoint.json dosyasına milestone/task durumu kaydedilir. Başlangıçta canResume() kontrolü, kullanıcıya sorma, kaldığı milestone'dan devam.
- **Gerekçe**: Fail-Safe ilkesi. Büyük projeler saatlerce sürebilir, her şeyi baştan başlatmak kabul edilemez.
- **Alternatifler**: STATE.md'den recovery (daha az granüler), session DB (karmaşık)
- **Durum**: active

---

## D024 — Codebase Context: Task Öncesi Otomatik Dosya Okuma

- **Tarih**: 2026-03-24T02:30:00+03:00
- **Bağlam**: Agent'lar göreve başladığında mevcut kodları bilmiyor, sıfırdan yazıyor (D007 memory injection sadece hafıza dosyalarını veriyor, codebase'i vermiyor)
- **Karar**: CodebaseReader: scanProject() ile src/ tara, getRelevantFiles(task, architecture) ile ilgili dosyaları seç, buildContextSummary() ile özet oluştur. ContextBuilder.buildPrompt()'a "## Mevcut Codebase" bölümü eklendi. Max 8000 token. Task pattern matching: auth→auth dosyaları, frontend→API+types, test→implementation dosyaları.
- **Gerekçe**: Agent göreve başlamadan önce mevcut kodun ne olduğunu bilmeli. Yoksa duplicate kod yazar, var olan modülleri yeniden implement eder. Memory-First ilkesi genişletildi: kod da hafıza.
- **Alternatifler**: Her agent'a tüm kodu gönder (token bütçesi aşılır), RAG ile retrieval (karmaşık + latency), sadece import graph analizi (yüzeysel)
- **Durum**: active

---

## D025 — Integration Evaluator: HTTP Endpoint Testi

- **Tarih**: 2026-03-24T02:30:00+03:00
- **Bağlam**: Evaluator v2 (D013) sadece tsc/npm test çalıştırıyor, gerçek HTTP endpoint'lerin çalışıp çalışmadığını test etmiyor
- **Karar**: IntegrationEvaluator: startServer() ile server başlat, waitForReady() ile hazır bekle, testEndpoint() ile HTTP istek at. Task'tan otomatik test senaryosu çıkarma: auth→register+login, todo→CRUD, genel→root+health. Timeout: 30s server, 10s request. Server başlamazsa WARN (FAIL değil). Sonuç RealEvaluationResult.integrationTests'e eklenir.
- **Gerekçe**: "npm test geçiyor" ≠ "endpoint çalışıyor". Gerçek HTTP isteği yalan söyleyemez. Evaluator v2'nin doğal uzantısı.
- **Alternatifler**: Supertest (dependency), sadece port check (shallow), curl ile test (parse zor)
- **Durum**: active

---

## D026 — SmartBrief: Tek Soru → Otomatik Analiz → Ürün Soruları → Kararlar

- **Tarih**: 2026-03-24T03:30:00+03:00
- **Bağlam**: BriefCollector (D012) 7+ soru soruyor (stack, scope, anti-scope ayrı ayrı). ArchitectAgent (D020) 5 teknik soru daha soruyor. Toplam 12+ soru — kullanıcı yoruluyor.
- **Karar**: SmartBrief: 1 soru ("ne yapmak istiyorsun?") → otomatik analiz (teknik kararları brief'ten çıkar) → sadece belirsiz ürün soruları sor (max 4, hepsi opsiyonel) → anti-scope otomatik çıkar → özet göster. Pattern matching ile auth/DB/API/frontend/deploy otomatik. Kullanıcıya sadece "linkler herkese açık mı?" gibi kavramsal sorular sorulur.
- **Gerekçe**: Kullanıcı developer değil, ürün düşünürü (MISSION). Teknik detaylar onun işi değil. 12 soru yerine 1+3 = max 4 etkileşim. BriefCollector + ArchitectAgent backward compatible kalır, SmartBrief yeni flow.
- **Alternatifler**: LLM ile brief analizi (maliyet + latency), sadece template (esneklik yok), tüm soruları koruma (UX kötü)
- **Durum**: active
