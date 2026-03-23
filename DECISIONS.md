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
