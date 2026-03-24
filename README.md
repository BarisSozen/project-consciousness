# CSNS

> **C**ode-aware **S**elf-correcting **N**ever-forgetting **S**ystem

Just say what you want. It handles the rest.
Or point it at existing code — it reverse-engineers, audits, and scores your architecture.

**Multi-model** · **Multi-language** · **Memory-first** · **Self-correcting** · **Codebase auditor**

```bash
npm install -g @barissozen/csns
csns
```

---

## What It Does

```
csns> /new "URL shortener with auth"     → builds it from scratch
csns> /audit                              → reverse-engineers & scores existing code
csns> /trace                              → 4-layer deep analysis
csns> /health                             → checks LLM + agent + memory status
```

**Two modes:**
1. **Build** — describe what you want, CSNS makes technical decisions, writes code, tests it, audits the result
2. **Audit** — point it at any TypeScript project, it classifies layers, traces data flows, checks architectural decisions, scores health 0–100

---

## Demo: Build

```
$ csns

  ╔══════════════════════════════════════════════╗
  ║   CSNS v0.7.5                                ║
  ║   Code-aware Self-correcting                 ║
  ║   Never-forgetting System                    ║
  ╚══════════════════════════════════════════════╝

  Type /help for commands, /quit to exit.

  csns> /new
  📋 What do you want to build?
  > URL shortener with user registration

  🔍 Analyzing...
  ✅ JWT Auth · ✅ SQLite · ✅ REST API · ✅ TypeScript

  🚀 Starting orchestration...
  📦 M01: Foundation → ✅ (tsc ✅, test ✅)
  📦 M02: Auth       → ✅ (tsc ✅, test ✅, endpoint ✅)
  📦 M03: Shortener  → ✅ (tsc ✅, test ✅, endpoint ✅)

  🔍 Post-build audit...
  💯 Health: 94/100 — 2 minor violations, auto-fixing...
  ✅ Re-audit: 100/100

  csns> /quit
  👋 Bye.
```

## Demo: Audit

```
  csns> /audit
  🔍 Running reverse engineering audit...

  ═══════════════════════════════════════════
  📋 AUDIT REPORT
  ═══════════════════════════════════════════

  🏗️  Layer Distribution:
     controller    42    service    37    middleware    17
     repository    239   config     16    schema       10

  🔀 Data Flows: 5/68 complete

  ⚠️  Violations: 43 (43 acknowledged, 0 real)
     ✅ 19x GraphQL resolver-first pattern
     ✅ 30x Inline resolver logic — accepted convention

  🧩 Patterns:
     GraphQL Federation · GraphQL Resolvers · Event-Driven
     Circuit Breaker · Service Layer · Middleware Chain

  💯 Health Score: 96/100
  ═══════════════════════════════════════════
```

---

## Install

```bash
npm install -g @barissozen/csns
csns
```

**Requirements:** Node.js 20+, at least one LLM provider

```bash
# Pick one:
export ANTHROPIC_API_KEY=sk-ant-...       # Claude
export OPENAI_API_KEY=sk-...              # GPT-4o / o-series
export OLLAMA_HOST=http://localhost:11434  # Local (Llama, Mistral, etc.)
```

---

## Multi-Model Support

| Provider | Env Variable | Models |
|----------|-------------|--------|
| **Anthropic** (default) | `ANTHROPIC_API_KEY` | Claude Sonnet, Opus, Haiku |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o, o1, o3 |
| **Ollama** | `OLLAMA_HOST` | Llama 3, Mistral, CodeLlama, any local model |
| **OpenAI-compatible** | `OPENAI_API_KEY` + `LLM_BASE_URL` | Groq, Together, Azure, etc. |

```bash
# Auto-detect from env
csns

# Explicit override
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... csns

# Local — no API key needed
LLM_PROVIDER=ollama csns
```

---

## CLI Commands

### Interactive (REPL)

```
csns                           → starts interactive prompt
csns> /new [brief]             → build a new project
csns> /audit                   → reverse-engineer & audit codebase
csns> /trace                   → full 4-layer analysis
csns> /status                  → show STATE.md
csns> /log                     → show DECISIONS.md
csns> /health                  → check LLM + agent CLI + memory files
csns> /help                    → list commands
csns> /quit                    → exit
```

### Non-interactive (CI / scripts)

```bash
csns new "Build a todo API with auth"
csns audit
csns trace
csns status
csns health
```

---

## Audit Engine

The `/audit` command reverse-engineers any TypeScript project:

### 4 Layers

| Layer | What | How |
|-------|------|-----|
| **Static** | Import/export graph, dead exports, circular deps, phantom deps | Regex scan of all `.ts` files |
| **Semantic** | "This service should be injected but isn't" | LLM reasoning over graph + file summaries |
| **Runtime** | Server started, HTTP probed, handler chain traced | Express middleware + HTTP probing |
| **Audit** | Architecture recovery, decision archaeology, pattern detection | Layer classification + cross-reference |

### What It Finds

| Finding | Example |
|---------|---------|
| **Layer skip** | Controller → Repository (skipping service layer) |
| **Wrong direction** | Service imports controller (upward dependency) |
| **Dead export** | `unusedHelper()` exported but never imported |
| **Circular dep** | `logger → config → logger` |
| **Phantom dep** | `winston` imported but not in `package.json` |
| **Decision contradiction** | ARCHITECTURE says JWT but code uses session |
| **Pattern inconsistency** | 7 routes use service layer, 52 don't |

### Smart Acknowledgement

CSNS distinguishes **design decisions** from **real bugs**:

```
Violation found
    │
    ├── GraphQL resolver → DB direct?  → ✅ Acknowledged (resolver-first pattern)
    ├── Written in ARCHITECTURE.md?    → ✅ Acknowledged (explicit decision)
    ├── >80% routes follow same way?   → ✅ Acknowledged (project convention)
    │
    └── None of the above?             → ⚠️ Real issue — counts against health
```

### Tested On Real Projects

```
Project               Files  Violations           Health
──────────────────────────────────────────────────────────
Cayman Data              37    0 (0 ack, 0 real)  100.0 💯
Yieldex                  84    1 (0 ack, 1 real)   98.3
Wallet SDK               26    1 (0 ack, 1 real)   97.8
Cayman-Hashlock         530   43 (43 ack, 0 real)  96.0
CSNS (self)              72    6 (2 ack, 4 real)   93.0
Cayman Mobile            32    5 (0 ack, 5 real)   89.4
```

### Programmatic

```typescript
import { ReverseEngineer } from '@barissozen/csns/agent';

const auditor = new ReverseEngineer('/path/to/project');
const report = await auditor.audit();

report.classifications   // file → layer mapping
report.dataFlows         // end-to-end request chains
report.violations        // architectural issues (acknowledged vs real)
report.decisionAudit     // DECISIONS.md cross-check
report.patterns          // detected design patterns
report.summary.healthScore  // 0–100
```

---

## Build Engine

### The 4-File Memory System

| File | What | Who |
|------|------|-----|
| `MISSION.md` | What to build, what NOT to build, success criteria | You (immutable) |
| `ARCHITECTURE.md` | Technical decisions — auth, DB, API style | System (auto) |
| `DECISIONS.md` | Every decision + rationale (append-only) | Log |
| `STATE.md` | Current phase, what's done, what's left | Live |

### Build → Audit → Fix Loop

```
/new "Build a todo API"
    │
    ▼
SmartBrief → Scaffold → Orchestrator → Agents write code
    │                                        │
    │                                   tsc ✅ test ✅
    │                                        │
    ▼                                        ▼
MISSION.md                             Audit Gate (automatic)
ARCHITECTURE.md                        Health < 70? → Fix tasks
DECISIONS.md                           Re-audit → ✅ Done
STATE.md
```

### What It Asks vs. What It Decides

| Asks you ✅ | Decides itself ❌ |
|---|---|
| "Are links public or private?" | JWT or session? |
| "Can users see each other's data?" | Which database? |
| "Will there be payments?" | REST or GraphQL? |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `LLM_PROVIDER` | Force: `anthropic` / `openai` / `ollama` | auto-detect |
| `LLM_MODEL` | Model name | provider default |
| `LLM_BASE_URL` | Custom API base URL | — |
| `AGENT_BINARY` | Coding agent CLI binary | `claude` |
| `CSNS_LOCALE` | Language: `en` / `tr` | `en` |

### Programmatic

```typescript
import { Orchestrator } from '@barissozen/csns/orchestrator';
import { createProvider } from '@barissozen/csns/llm';
import { TracerAgent } from '@barissozen/csns/agent';

// Build
const orchestrator = new Orchestrator({
  projectRoot: process.cwd(),
  llmProvider: 'openai',
  llmApiKey: 'sk-...',
  locale: 'en',
  maxRetries: 3,
  verbose: true,
});
await orchestrator.run('Build a REST API for todos');

// Audit
const tracer = new TracerAgent({
  projectRoot: '/path/to/project',
  llmProvider: createProvider(),
});
const report = await tracer.run();
```

---

## Project Structure

```
src/
├── bin/             CLI — csns (interactive REPL + non-interactive)
├── brief/           SmartBrief + BriefCollector
├── agent/           Agent Runner, Context Builder, Codebase Reader
│   └── tracer/      Static Analyzer, Semantic Analyzer, Runtime Tracer,
│                    Reverse Engineer (audit engine)
├── orchestrator/    Planner, Evaluator, Escalator, Scaffold, Audit Gate
├── memory/          4-file read/write layer
├── llm/             Provider abstraction (Anthropic, OpenAI, Ollama)
├── i18n/            Internationalization (en, tr)
└── types/           TypeScript interfaces
```

## Tests

```bash
npm test                          # 229 tests, 19 suites
SKIP_E2E=1 npm test               # skip real CLI tests
```

## Design Principles

1. **Memory-First** — Every decision leaves a trace in files
2. **Fail-Safe** — When in doubt, ask the human
3. **Append-Only** — DECISIONS.md is never edited
4. **Provider-Agnostic** — Any LLM, any agent CLI
5. **Acknowledged vs Real** — Design decisions ≠ bugs

## Contributing

1. Fork → branch → test → PR
2. `npm test` must pass
3. `npx tsc --noEmit` — 0 errors
4. Conventional commits (`feat:`, `fix:`, `docs:`)

## License

MIT — [Baris Sozen](https://github.com/BarisSozen)
