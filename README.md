# Project Consciousness

> Multi-agent orchestration with persistent memory — agents never forget why they exist.

## Problem

Multi-agent sistemlerde en büyük sorun **hafıza kaybı**. Agent'lar uzun süre çalıştıkça misyondan sapar, tutarsız kararlar alır, "neden bu projeyi yapıyoruz" sorusunun cevabını unutur.

## Çözüm

Dosya tabanlı **dış hafıza sistemi** + **orchestrator agent**.

```
USER (Brief) → ORCHESTRATOR → AGENTS → MEMORY LAYER
                  │                        │
                  ├── Planner              ├── MISSION.md (immutable)
                  ├── Evaluator            ├── ARCHITECTURE.md (slow-change)
                  └── Escalator            ├── DECISIONS.md (append-only)
                                           └── STATE.md (live-update)
```

### Akış

1. Kullanıcı **bir kez** brief verir
2. Orchestrator **plan çıkarır** (task ağacı)
3. Agent'lar **çalışır**, her adımda hafızayı okur
4. Orchestrator çıktıyı **değerlendirir** (tutarlılık, kalite, misyon uyumu)
5. Sorun varsa → **revize** veya **eskalasyon** (insana sor)
6. Proje tamamlanır ✅

## Kurulum

```bash
cd project-consciousness
npm install
```

## Kullanım

```bash
# Brief ile çalıştır
npx tsx src/index.ts "Multi-agent sistemi için hafıza katmanı kur"

# veya pipe ile
echo "Brief metni" | npx tsx src/index.ts
```

## Test

```bash
npm test
```

## Hafıza Dosyaları

| Dosya | Değişim Hızı | Kim Yazar |
|-------|-------------|-----------|
| `MISSION.md` | Asla | Sadece insan |
| `ARCHITECTURE.md` | Yavaş | Onaylı değişiklikler |
| `DECISIONS.md` | Her karar | Append-only log |
| `STATE.md` | Sürekli | Orchestrator |

## Stack

- **TypeScript** + Node.js
- **Claude API** (orchestrator reasoning)
- **Claude Code** (agent execution)
- **File System** (persistence — no DB)

## Lisans

MIT
