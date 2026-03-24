# Project Consciousness

> Just say what you want. It handles the rest.

AI agents that don't ask you "which framework?" or "JWT or session?" — you describe what you need, the system makes the technical decisions itself.

**Multi-model** · **Multi-language** · **Memory-first** · **Self-correcting**

---

## Demo

```
$ pc init

📋 What do you want to build?
> I want a URL shortener with user registration, redirect on click,
  links never expire

🔍 Analyzing...
   ✅ JWT Auth (registration detected)
   ✅ SQLite (lightweight, sufficient)
   ✅ REST API
   ✅ TypeScript + Node.js

❓ A few product questions:

   Are shortened links public or login-only?
   1. Public
   2. Login only
   3. Both (configurable)
   > 1

   Can users see each other's links?
   1. Yes, everyone sees all
   2. No, only their own
   3. Optional sharing
   > 2

╔══════════════════════════════════════════════╗
║              Plan Summary                    ║
╚══════════════════════════════════════════════╝

 ✅ JWT Auth        ❌ No frontend (API only)
 ✅ SQLite          ❌ No payment system
 ✅ REST API

$ pc run

🚀 Orchestration starting...
📦 Milestone M01: Foundation — DB schema, config
📦 Milestone M02: Auth — register, login, JWT
📦 Milestone M03: URL Shortener — CRUD, redirect
🤖 Agent working: M01...
✅ M01 completed (tsc ✅, test ✅)
🤖 Agent working: M02...
✅ M02 completed (tsc ✅, test ✅, endpoint ✅)
🤖 Agent working: M03...
✅ M03 completed (tsc ✅, test ✅, endpoint ✅)

✅ Project complete — 3/3 milestones successful
```

---

## Install

```bash
npx project-consciousness init     # try instantly
# or
npm install -g project-consciousness
pc init
pc run
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

Use any LLM provider — switch with a single env variable:

| Provider | Env Variable | Models |
|----------|-------------|--------|
| **Anthropic** (default) | `ANTHROPIC_API_KEY` | Claude Sonnet, Opus, Haiku |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o, o1, o3 |
| **Ollama** | `OLLAMA_HOST` | Llama 3, Mistral, CodeLlama, any local model |
| **OpenAI-compatible** | `OPENAI_API_KEY` + `LLM_BASE_URL` | Groq, Together, Azure, etc. |

```bash
# Auto-detect: whichever key exists is used
export ANTHROPIC_API_KEY=sk-ant-...
pc run "Build a todo API"

# Explicit override
LLM_PROVIDER=openai OPENAI_API_KEY=sk-... pc run "Build a todo API"

# Local Ollama (no API key needed)
LLM_PROVIDER=ollama pc run "Build a todo API"
```

### Programmatic

```typescript
import { createProvider } from 'project-consciousness/llm';

// Auto-detect from env
const provider = createProvider();

// Or explicit
const claude = createProvider({ provider: 'anthropic', apiKey: 'sk-ant-...' });
const gpt = createProvider({ provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o' });
const local = createProvider({ provider: 'ollama', model: 'llama3' });
```

---

## Multi-Language (i18n)

All user-facing messages, prompts, and agent personas support multiple languages:

```bash
PC_LOCALE=en pc run "Build a todo API"     # English (default)
PC_LOCALE=tr pc run "Todo API yap"         # Türkçe
```

Currently supported: **English** (`en`), **Turkish** (`tr`). Adding a new locale is one file — see `src/i18n/`.

---

## Agent CLI Abstraction

The orchestrator spawns coding agents via CLI. Default is Claude Code, but any compatible CLI works:

```bash
AGENT_BINARY=claude pc run "..."     # Claude Code (default)
AGENT_BINARY=codex pc run "..."      # OpenAI Codex CLI
AGENT_BINARY=aider pc run "..."      # Aider
```

The agent receives a prompt via stdin and returns structured output. Any CLI that accepts `--print` mode or stdin prompts can be plugged in.

---

## How It Works

### The 4-File Memory System

Everything runs on 4 markdown files. Agents read them before every task and never forget why they exist.

| File | What It Contains | Owned By |
|------|-----------------|----------|
| `MISSION.md` | What to build, what NOT to build, success criteria | You (immutable) |
| `ARCHITECTURE.md` | Technical decisions — auth, DB, API style | System (auto) |
| `DECISIONS.md` | Every decision, why it was made, when | Log (append-only) |
| `STATE.md` | Current phase, what's done, what's left | Live status |

### Architecture

```
You: "I want a URL shortener..."
 │
 ▼
┌─────────────────────────────────┐
│  SmartBrief                      │
│  1 question → analysis →         │
│  product questions only          │
│  → MISSION.md + ARCHITECTURE.md  │
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Orchestrator                    │
│  Plan → Milestone → Agent → Test │
│  Failed? → 3x retry → ask you   │
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Memory Layer                    │
│  Every decision → DECISIONS.md   │
│  Every step → STATE.md           │
│  Nothing is lost                 │
└─────────────────────────────────┘
```

### What It Asks vs. What It Decides

| Asks you ✅ | Decides itself ❌ |
|---|---|
| "Are links public or private?" | JWT or session? |
| "Can users see each other's data?" | Which database? |
| "Will there be payments?" | REST or GraphQL? |
| "Do links expire?" | File structure? |

Technical decisions are inferred from your brief. Only **product decisions** — things you need to know — are asked.

### Quality Control Pipeline

After code is written, it's verified:

1. **Type checking** — `tsc --noEmit`
2. **Test execution** — `vitest run` / `pytest` / `go test`
3. **HTTP endpoint testing** — server started, real HTTP requests sent
4. **Anti-scope enforcement** — protected files touched? forbidden deps added?

Failed? 3x auto-retry with feedback → still failing? → escalation to you.

### Tracer Agent — Data Flow Inspector

A specialized agent that "walks" through the project, tracking data flow and finding wiring problems:

```typescript
import { TracerAgent } from 'project-consciousness/agent';

const tracer = new TracerAgent({
  projectRoot: process.cwd(),
  llmProvider: provider,     // any LLMProvider
  port: 3000,
});

const report = await tracer.run();
// report.staticIssues     → dead exports, circular deps, phantom deps
// report.semanticInsights → LLM-detected injection gaps, config mismatches
// report.runtimeTraces    → HTTP probe results, handler chains, data flow
```

**3-layer analysis:**

| Layer | What | How |
|-------|------|-----|
| **Static** | Import/export graph, dead code, circular deps, phantom deps | Regex scan of all `.ts` files |
| **Semantic** | "This service should be injected but isn't" | LLM reasoning over graph + file summaries |
| **Runtime** | Server started, HTTP probed, handler chain traced | Express middleware injection + HTTP probing |

---

## CLI Commands

| Command | What It Does |
|---------|-------------|
| `pc init` | Collect brief → create 4 memory files |
| `pc run` | Start the orchestrator |
| `pc run "Build a todo API"` | Start with inline brief |
| `pc status` | Show STATE.md |
| `pc log` | Show DECISIONS.md |
| `pc help` | Help |

---

## Traceability

Everything is logged, nothing is deleted:

```markdown
## D024 — Codebase Context: Pre-Task File Reading
- **Date**: 2026-03-24T02:30:00+03:00
- **Decision**: CodebaseReader scans src/, selects relevant files per task
- **Rationale**: Agent must know existing code, otherwise writes duplicates
- **Status**: active
```

6 months later: "why did we do it this way?" → `DECISIONS.md`.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `LLM_PROVIDER` | Force provider: `anthropic`, `openai`, `ollama` | auto-detect |
| `LLM_MODEL` | Model name | provider default |
| `LLM_BASE_URL` | Custom API base URL (OpenAI-compatible) | — |
| `AGENT_BINARY` | Coding agent CLI binary | `claude` |
| `PC_LOCALE` | Language: `en`, `tr` | `en` |

### Programmatic

```typescript
import { Orchestrator } from 'project-consciousness/orchestrator';

const orchestrator = new Orchestrator({
  projectRoot: process.cwd(),
  llmProvider: 'openai',
  llmApiKey: 'sk-...',
  llmModel: 'gpt-4o',
  agentBinary: 'claude',
  locale: 'en',
  maxRetries: 3,
  escalationThreshold: 0.4,
  maxParallelAgents: 3,
  verbose: true,
});

const session = await orchestrator.run('Build a REST API for todos');
```

---

## Developer Notes

### Project Structure

```
src/
├── brief/           SmartBrief + BriefCollector
├── agent/           Agent Runner, Context Builder, Codebase Reader
│   └── tracer/      Tracer Agent (static + semantic + runtime analysis)
├── orchestrator/    Planner, Evaluator, Escalator, Integration Evaluator
├── memory/          4-file read/write layer
├── llm/             LLM provider abstraction (Anthropic, OpenAI, Ollama)
├── i18n/            Internationalization (en, tr)
├── types/           TypeScript interfaces
└── bin/             CLI (pc init/run/status/log)
```

### Test

```bash
npm test                                    # 229 tests, 19 suites
npx vitest run tests/tracer-agent.test.ts   # specific suite
SKIP_E2E=1 npm test                         # skip real CLI tests
```

TypeScript strict mode, 0 errors. Vitest for testing.

### Stack

- **TypeScript + Node.js** — strict mode, ESM
- **LLM Providers** — Anthropic SDK, OpenAI API, Ollama REST (pluggable)
- **Agent Execution** — Claude Code CLI (configurable)
- **Testing** — Vitest (229 tests)
- **Storage** — File system (markdown, no DB)

### Design Principles

1. **Memory-First** — Every decision leaves a trace in files
2. **Fail-Safe** — When in doubt, ask the human
3. **Append-Only** — DECISIONS.md is never edited
4. **Minimal** — File system is enough, no DB needed
5. **Human-Readable** — All state is markdown
6. **Provider-Agnostic** — Works with any LLM, any agent CLI

### Contributing

1. Fork → branch → test → PR
2. `npm test` must pass
3. `npx tsc --noEmit` must show 0 errors
4. Conventional commits (`feat:`, `fix:`, `docs:`)

## License

MIT — [Baris Sozen](https://github.com/BarisSozen)
