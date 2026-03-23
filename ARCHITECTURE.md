# ARCHITECTURE — Project Consciousness

> Yavaş değişir. Her mimari karar DECISIONS.md'ye loglanır.

## Genel Bakış

```
┌─────────────────────────────────────────────────┐
│                   USER (Brief)                   │
│                      │                           │
│                      ▼                           │
│             ┌─────────────────┐                  │
│             │  ORCHESTRATOR   │                  │
│             │  ┌───────────┐  │                  │
│             │  │  Planner  │  │                  │
│             │  │ Evaluator │  │                  │
│             │  │ Escalator │  │                  │
│             │  └───────────┘  │                  │
│             └────────┬────────┘                  │
│                      │                           │
│          ┌───────────┼───────────┐               │
│          ▼           ▼           ▼               │
│     ┌────────┐ ┌────────┐ ┌────────┐            │
│     │ Agent  │ │ Agent  │ │ Agent  │            │
│     │   A    │ │   B    │ │   C    │            │
│     └────┬───┘ └────┬───┘ └────┬───┘            │
│          │           │           │               │
│          └───────────┼───────────┘               │
│                      ▼                           │
│  ┌──────────────────────────────────────────┐    │
│  │           MEMORY LAYER (File System)      │    │
│  │                                           │    │
│  │  MISSION.md ─── asla değişmez             │    │
│  │  ARCHITECTURE.md ─── yavaş değişir        │    │
│  │  DECISIONS.md ─── her karar loglanır      │    │
│  │  STATE.md ─── sürekli güncellenir         │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Stack

| Katman       | Teknoloji            | Neden                        |
|-------------|----------------------|------------------------------|
| Runtime     | Node.js + TypeScript | Type safety, ecosystem       |
| Storage     | File System (MD)     | Sadelik, okunabilirlik       |
| LLM         | Claude API           | Orchestrator reasoning       |
| Agent       | Claude Code (pi/gsd) | Kod üretimi, task execution  |
| Config      | JSON/YAML            | Declarative task tanımları   |

## Katman Sorumlulukları

### 1. Memory Layer (`src/memory/`)
- 4 dosyayı okur/yazar
- MISSION.md: salt okunur, validasyon yapar
- ARCHITECTURE.md: değişiklik önerisi üretir, onay bekler
- DECISIONS.md: append-only log
- STATE.md: her task sonrası günceller

### 2. Orchestrator (`src/orchestrator/`)
- **Planner**: Brief'ten task ağacı çıkarır
- **Evaluator**: Agent çıktısını hafızaya karşı değerlendirir
- **Escalator**: İnsan müdahalesi gerekip gerekmediğine karar verir
- Her task öncesi ve sonrası memory'yi okur
- Tutarlılık skoru hesaplar

### 3. Agent Runner (`src/agent/`)
- Claude Code instance'ları spawn eder
- Task context'ini hazırlar (memory snapshot + task spec)
- Çıktıyı toplar ve orchestrator'a iletir
- Paralel / sıralı çalışma modları

### 4. Task System (`src/task/`)
- Task tanımları (JSON)
- Bağımlılık grafı
- Durum takibi (pending → running → done/failed)
- Retry / escalation politikaları

## Tasarım İlkeleri

1. **Memory-First**: Her karar hafızada iz bırakır
2. **Fail-Safe**: Şüphe durumunda insana sor
3. **Append-Only Log**: DECISIONS.md asla düzenlenmez, sadece eklenir
4. **Minimal Complexity**: Dosya sistemi yeterli, DB gereksiz
5. **Human-Readable**: Tüm state markdown, insan okuyabilir
6. **Composable**: GSD-2 üstüne oturur, onu replace etmez

## Dosya Formatları

### STATE.md Yapısı
```markdown
# STATE
## Current Phase: [planning|executing|reviewing|completed]
## Active Tasks
- [ ] Task ID — description — assigned agent — status
## Completed Tasks  
- [x] Task ID — description — outcome summary
## Blocked
- Task ID — reason — escalation status
## Last Updated: ISO timestamp
```

### DECISIONS.md Yapısı
```markdown
# DECISIONS
## D001 — Karar Başlığı
- **Tarih**: ISO timestamp
- **Bağlam**: Neden bu karar gerekti
- **Karar**: Ne kararlaştırıldı
- **Gerekçe**: Neden bu seçenek seçildi
- **Alternatifler**: Değerlendirilen diğer seçenekler
- **Durum**: active | superseded | reverted
```
