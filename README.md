# Project Consciousness

> Sadece ne istediğini söyle, gerisini halleder.

Yapay zeka agent'ları sana "hangi framework?", "JWT mi session mı?", "database ne olsun?" diye sormak yerine — sen sadece ne istediğini anlat, sistem teknik kararları kendisi alsın.

---

## Demo

```
$ pc init

📋 Ne yapmak istiyorsun?
> URL shortener istiyorum, kayıt olsun, link tıklanınca 
  redirect olsun, linkler süresi dolmasın

🔍 Analiz ediliyor...
   ✅ JWT Auth (kayıt sistemi algılandı)
   ✅ SQLite (hafif, yeterli)
   ✅ REST API
   ✅ TypeScript + Node.js

❓ Birkaç şey sormam gerekiyor:

   Kısaltılmış linkler herkese açık mı, sadece giriş yapanlara mı?
   1. Herkese açık
   2. Sadece giriş yapanlar
   3. İkisi de (seçilebilir)
   > 1

   Kullanıcılar birbirinin linklerini görebilir mi?
   1. Evet, herkes görür
   2. Hayır, sadece kendi
   3. Opsiyonel paylaşım
   > 2

╔══════════════════════════════════════════════╗
║         Plan Özeti                            ║
╚══════════════════════════════════════════════╝

 ✅ JWT Auth
 ✅ SQLite
 ✅ REST API
 ❌ Frontend yok (sadece API)
 ❌ Ödeme sistemi yok

📋 Başarı Kriterleri:
   • npm test geçmeli
   • kayıt olsun
   • link tıklanınca redirect olsun
   • linkler süresi dolmasın

$ pc run

🚀 Orchestrator başlatıldı...
📐 Mimari kararlar uygulanıyor...
📦 Milestone M01: Foundation — DB schema, config
📦 Milestone M02: Auth — register, login, JWT
📦 Milestone M03: URL Shortener — CRUD, redirect
🤖 Agent çalışıyor: M01...
✅ M01 tamamlandı (tsc ✅, test ✅)
🤖 Agent çalışıyor: M02...
✅ M02 tamamlandı (tsc ✅, test ✅, endpoint ✅)
🤖 Agent çalışıyor: M03...
✅ M03 tamamlandı (tsc ✅, test ✅, endpoint ✅)

✅ Proje tamamlandı — 3/3 milestone başarılı
```

---

## Kurulum

```bash
# Hemen dene (kurulum gereksiz)
npx project-consciousness init

# veya global kur
npm install -g project-consciousness
pc init
pc run
```

**Gereksinimler:** Node.js 20+, [Anthropic API key](https://console.anthropic.com/)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Ne Sorar, Ne Sormaz

| Sana sorar ✅ | Kendisi karar verir ❌ |
|---|---|
| "Linkler herkese açık mı?" | JWT mi session mı? |
| "Kullanıcılar birbirini görebilir mi?" | Hangi database? |
| "Ödeme sistemi olacak mı?" | REST mi GraphQL mı? |
| "Linkler süresi dolar mı?" | Hangi dosya yapısı? |

Teknik kararları brief'inden otomatik çıkarır. Sadece **ürün kararlarını** — yani senin bilmen gereken şeyleri — sorar.

---

## Nasıl Çalışır

Her şey 4 dosya üzerinden döner:

| Dosya | Ne İçerir | Kimin |
|-------|-----------|-------|
| `MISSION.md` | Ne yapılacak, ne yapılmayacak, başarı kriterleri | Senin (değişmez) |
| `ARCHITECTURE.md` | Teknik kararlar — auth, DB, API stili | Sistem (otomatik) |
| `DECISIONS.md` | Her karar, neden alındı, ne zaman | Log (append-only) |
| `STATE.md` | Şu an hangi aşamada, ne bitti, ne kaldı | Canlı durum |

Agent her göreve başlamadan önce bu 4 dosyayı okur. "Neden bu projeyi yapıyoruz?" sorusunun cevabını asla unutmaz.

### Akış

```
Sen: "URL shortener istiyorum..."
 │
 ▼
┌─────────────────────────────────┐
│  SmartBrief                      │
│  1 soru → analiz → ürün soruları │
│  → MISSION.md + ARCHITECTURE.md  │
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Orchestrator                    │
│  Plan → Milestone → Agent → Test │
│  Başarısız? → 3x retry → sana   │
│  sor                             │
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Memory Layer                    │
│  Her karar DECISIONS.md'ye       │
│  Her adım STATE.md'ye            │
│  Hiçbir şey kaybolmaz            │
└─────────────────────────────────┘
```

### Kontrol Mekanizması

Kod yazıldıktan sonra gerçekten çalışıp çalışmadığı test edilir:

- **TypeScript derleme** — `tsc --noEmit` ile tip hataları
- **Test çalıştırma** — `vitest run` / `pytest` / `go test`
- **HTTP endpoint testi** — server başlatılır, gerçek HTTP isteği atılır
- **Anti-scope kontrolü** — korunan dosyalara dokunulmuş mu? yasaklı bağımlılık eklenmiş mi?

Başarısız olursa 3 kez otomatik düzeltme dener. Düzelmezse sana sorar.

---

## CLI Komutları

| Komut | Ne Yapar |
|-------|----------|
| `pc init` | Brief topla → 4 dosya oluştur |
| `pc run` | Orchestrator'u başlat |
| `pc run "Todo API yap"` | Brief ile direkt başlat |
| `pc status` | STATE.md'yi göster |
| `pc log` | DECISIONS.md'yi göster |
| `pc help` | Yardım |

---

## İzlenebilirlik

Her şey loglanır, hiçbir şey silinmez:

```markdown
## D024 — Codebase Context: Task Öncesi Otomatik Dosya Okuma
- **Tarih**: 2026-03-24T02:30:00+03:00
- **Karar**: CodebaseReader ile src/ taranır, task'a göre ilgili dosyalar seçilir
- **Gerekçe**: Agent mevcut kodu bilmeli, yoksa duplicate yazar
- **Durum**: active
```

6 ay sonra "neden böyle yapmışız?" sorusunun cevabı → `DECISIONS.md`.

---

## Geliştirici Notları

### Programmatic Kullanım

```typescript
import { SmartBrief } from 'project-consciousness/brief';
import { MemoryLayer } from 'project-consciousness/memory';
import { Orchestrator } from 'project-consciousness/orchestrator';
import { CodebaseReader } from 'project-consciousness/agent';

// Non-interactive brief (test / CI)
const sb = new SmartBrief();
const result = sb.runNonInteractive('URL shortener, kayıt olsun');
console.log(result.decisions);  // { auth: 'jwt', database: 'sqlite', ... }
console.log(result.antiScope);  // { forbiddenDeps: ['react', 'vue'], ... }
```

### Proje Yapısı

```
src/
├── brief/           SmartBrief + BriefCollector
├── agent/           Agent Runner, Context Builder, Codebase Reader
├── orchestrator/    Planner, Evaluator, Escalator, Integration Evaluator
├── memory/          4 dosya okuma/yazma
├── types/           TypeScript interface'ler
└── bin/             CLI (pc init/run/status/log)
```

### Test

```bash
npm test                              # 217 test, 18 suite
npx vitest run tests/smart-brief.test.ts   # spesifik suite
SKIP_E2E=1 npm test                   # Claude CLI testlerini atla
```

TypeScript strict mode, 0 error. Vitest ile test.

### Stack

- TypeScript + Node.js
- Claude API (orchestrator reasoning)
- Claude Code (agent execution)
- Vitest (test)
- Dosya sistemi (hafıza — DB yok)

### Tasarım İlkeleri

1. **Memory-First** — Her karar dosyada iz bırakır
2. **Fail-Safe** — Şüphe varsa insana sor
3. **Append-Only** — DECISIONS.md asla düzenlenmez
4. **Minimal** — Dosya sistemi yeterli, DB gereksiz
5. **Human-Readable** — Tüm state markdown

### Katkı

1. Fork → branch → test → PR
2. `npm test` geçmeli
3. `npx tsc --noEmit` 0 hata
4. Conventional commits (`feat:`, `fix:`, `docs:`)

## Lisans

MIT — [Baris Sozen](https://github.com/BarisSozen)
