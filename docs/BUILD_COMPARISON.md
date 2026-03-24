# CSNS Build Engine vs Code Generation Tools

> CSNS `/new` komutu ile kod üreten diğer araçların karşılaştırması + iyileştirme planı

---

## Rakip Haritası — Kod Üretme

```
                    Otonom Seviye
                         │
  Full-auto ─────────────┼──── Devin, Replit Agent
  (kendi başına yapar)    │     "Görevi ver, PR gelir"
                         │
  Guided-auto ───────────┼──── CSNS, Kiro, Bolt.new
  (plan → onay → yürüt)  │     "Plan göster, onay al, yap"
                         │
  Interactive ───────────┼──── Claude Code, Cursor, GSD (pi)
  (her adımda insan)      │     "Beraber yazalım"
                         │
  Autocomplete ──────────┼──── Copilot, Tabnine, Amazon Q
  (satır tamamla)         │     "Sonraki satırı tahmin et"
```

CSNS **guided-auto** kategorisinde: plan oluşturur, milestone'lara böler, agent'lara dağıtır, test eder, audit eder. Ama her kritik noktada insana sorar.

---

## Detaylı Karşılaştırma: Build Tarafı

### CSNS vs Devin

| | **CSNS** | **Devin** |
|---|---|---|
| **Metafor** | "Mühendislik ekibi + QA + auditor" | "Junior developer, tek başına çalışır" |
| **Ortam** | Senin makinende, CLI | Uzak VM, sandbox |
| **Plan** | LLM plan üretir → kullanıcı görür | Devin kendi planını yapar |
| **Yürütme** | Agent CLI (Claude/Codex/Aider) spawn | Kendi editörü + terminali |
| **Doğrulama** | tsc + test + HTTP probe + anti-scope + audit gate | Test çalıştırır, iterate eder |
| **Hafıza** | 4 dosya (MISSION, ARCHITECTURE, DECISIONS, STATE) | Session-scoped |
| **Post-build audit** | ✅ ReverseEngineer otomatik çalışır | ❌ Yok |
| **Karar kaydı** | ✅ DECISIONS.md'ye her karar yazılır | ❌ Yok |
| **Maliyet** | Sadece LLM API maliyeti | $500/ay/seat + $2/ACU |
| **Açık kaynak** | ✅ MIT | ❌ Kapalı |

**CSNS avantajı:** Post-build audit, karar arkeolojisi, şeffaf plan, ücretsiz.
**CSNS dezavantajı:** Devin kadar otonom değil — browser kullanamıyor, UI test yapamıyor.

### CSNS vs Bolt.new / Lovable / v0

| | **CSNS** | **Bolt.new / Lovable** |
|---|---|---|
| **Hedef kitle** | Developer | Developer + non-technical |
| **UI** | CLI (terminal) | Browser, live preview |
| **Ürettiği** | Layered backend (route→service→repo) + test | Frontend-ağırlıklı (React + Tailwind) |
| **Deploy** | ❌ Deploy yok | ✅ Netlify/Vercel one-click |
| **Test** | ✅ Otomatik vitest/pytest | ❌ Test üretmiyor |
| **Mimari doğrulama** | ✅ Audit gate | ❌ Yok |
| **Iterasyon** | Brief → plan → build → audit → fix loop | Chat-based iterasyon |

**CSNS avantajı:** Test yazıyor, mimari doğruluyor, backend-first.
**CSNS dezavantajı:** UI preview yok, deploy yok, frontend üretimi zayıf.

### CSNS vs Claude Code / Cursor / GSD (pi)

| | **CSNS** | **Claude Code / Cursor** |
|---|---|---|
| **Mod** | Otonom (plan → execute → audit) | İnteraktif (her mesajda insan kararı) |
| **Scope** | Proje geneli (milestone'lar) | Dosya/fonksiyon seviyesi |
| **Hafıza** | Kalıcı (4 markdown dosya) | Session-scoped (kaybolur) |
| **Planlama** | LLM otomatik plan + dependency graph | İnsan yönlendirir |
| **Doğrulama** | Otomatik (tsc + test + audit) | İnsan kontrol eder |
| **Çoklu model** | ✅ Anthropic, OpenAI, Ollama | Genelde tek model |

**CSNS avantajı:** Otonom çalışma, kalıcı hafıza, otomatik doğrulama.
**CSNS dezavantajı:** Gerçek zamanlı etkileşim yok, IDE entegrasyonu yok.

### CSNS vs Kiro (Amazon)

| | **CSNS** | **Kiro** |
|---|---|---|
| **Yaklaşım** | Brief → otomatik plan → build → audit | Spec-driven: Requirements → Design → Code |
| **Spec formatı** | MISSION.md + ARCHITECTURE.md (serbest) | EARS format (yapısal) |
| **Onay** | Eskalasyon mekanizması (skor < threshold) | Her faz arasında zorunlu onay |
| **Test** | ✅ Otomatik test üretimi + çalıştırma | ✅ Otomatik test suite |
| **Audit** | ✅ Post-build ReverseEngineer | ❌ Yok |
| **Maliyet** | Ücretsiz (+ LLM API) | $20-200/ay |

**CSNS avantajı:** Post-build audit, karar arkeolojisi, ücretsiz.
**CSNS dezavantajı:** Kiro'nun EARS spec formatı daha yapısal.

---

## CSNS Build Tarafının Gerçek Eksikleri

### 1. Frontend üretimi yok
Scaffold sadece backend üretiyor (Express routes → services → repos). React/Next.js frontend scaffold'u yok.

### 2. Deploy pipeline yok
Kod üretip bırakıyor. Dockerfile, CI/CD, Vercel/Netlify deploy yok.

### 3. Live preview yok
Bolt.new gibi browser'da anlık sonuç göstermiyor.

### 4. UI test yok
Sadece unit + integration test. Playwright/E2E browser testi yok.

### 5. Scaffold çok basit
Tek bir "resource" CRUD üretiyor. Brief'ten entity detection yapıp birden fazla resource üretmiyor.

### 6. Git entegrasyonu yok
Branch oluşturma, commit, PR açma otomatik değil.

---

## İyileştirme Planı — Build Tarafı

### Phase B1: Smart Scaffold (Brief → Multi-Entity)

Brief'ten entity'leri çıkar, her biri için route + service + repo üret:
```
csns> /new "Todo app with users, projects, and tasks. Users can share projects."

Detected entities: User, Project, Task
Relations: User → Project (many-to-many), Project → Task (one-to-many)

Generating:
  src/routes/users.ts     → CRUD + share endpoint
  src/routes/projects.ts  → CRUD + members
  src/routes/tasks.ts     → CRUD scoped to project
  src/services/...
  src/repositories/...
  src/models/schema.ts    → Drizzle/Prisma schema
```

### Phase B2: Frontend Scaffold

Brief'te "frontend" veya "UI" varsa → Next.js/React scaffold üret:
```
web/
├── app/layout.tsx
├── app/page.tsx
├── app/(auth)/login/page.tsx
├── app/(dashboard)/projects/page.tsx
├── components/ui/...      (shadcn/ui)
├── lib/api.ts             (backend client)
```

### Phase B3: Deploy Pipeline

`csns> /deploy` komutu:
```
Detected: Node.js + Express
Generating:
  Dockerfile
  docker-compose.yml
  .github/workflows/ci.yml
  vercel.json (if Next.js)
```

### Phase B4: Git Integration

Build sonrası otomatik:
```
git checkout -b feature/csns-build-20260324
git add .
git commit -m "feat: scaffold todo API (CSNS auto-generated)"
# Optional: gh pr create
```

### Phase B5: Live Preview (Browser)

Build sonrası `npm run dev` başlat, browser aç:
```
csns> /new "Todo API"
...
🚀 Dev server starting on http://localhost:3000
🌐 Opening browser...
```

### Phase B6: E2E Test Generation

Playwright test scaffold'u:
```
tests/e2e/
├── auth.spec.ts      → register + login flow
├── todos.spec.ts     → CRUD + validation
├── permissions.spec.ts → share + access control
```

---

## Tüm Araçların Konumlandırması (Build + Audit)

```
                        Audit Derinliği →
                    Yok    Yüzeysel   Derin
                    │         │         │
  Full-auto ────────┤ Devin   │         │
                    │         │         │
  Guided-auto ──────┤ Bolt    │  Kiro   │── CSNS ★
                    │ Lovable │         │   (Build + Deep Audit)
                    │         │         │
  Interactive ──────┤ Cursor  │ Augment │── Claude (manual)
                    │ GSD/pi  │         │
                    │         │         │
  Review-only ──────┤         │CodeRabb.│
                    │         │         │
```

**CSNS'in benzersiz konumu:** Guided-auto build + deep audit. Hiçbir başka araç bu ikisini birlikte yapmıyor.

---

## Özet: Nereye Odaklanmalı?

| Öncelik | Neden |
|---------|-------|
| **1. Security Scanner** | En büyük fark Claude'a karşı — JWT, CSP, secret, SQL injection taraması |
| **2. Smart Scaffold** | Brief'ten çoklu entity çıkarma — Bolt/Lovable rekabeti |
| **3. PR Review Mode** | `csns review` — CodeRabbit rekabeti |
| **4. Frontend Scaffold** | Next.js/React üretimi — Bolt/v0 rekabeti |
| **5. AST Analysis** | Regex → TypeScript compiler — Augment kalitesi |
| **6. Git + Deploy** | Tam döngü: build → test → audit → commit → deploy |
