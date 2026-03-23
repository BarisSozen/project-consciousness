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
