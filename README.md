# Project Consciousness

> Multi-agent orchestration with persistent memory — agents never forget why they exist.

## What Is This?

Project Consciousness is an **orchestration layer** for multi-agent AI systems that solves the biggest problem in long-running agent workflows: **memory loss**. When agents work on complex tasks over extended periods, they drift from the original mission, make contradictory decisions, and forget context. This system gives every agent a shared, persistent memory through four markdown files — so no matter how many agents run or how long they work, the answer to "why are we building this?" is always one file read away.

## How Is It Different?

| | Project Consciousness | GSD-2 | Paperclip |
|---|---|---|---|
| **Focus** | Memory persistence + orchestration | Task management + subagents | Full autonomous agent |
| **Memory** | 4 markdown files (MISSION, ARCH, DECISIONS, STATE) | Session-based | Internal state |
| **Relationship** | Sits on top of GSD-2 | Standalone | Standalone |
| **Complexity** | Minimal (file system, no DB) | Medium | Heavy |
| **Human role** | Brief once, intervene on escalation | Interactive | Minimal |
| **Anti-scope** | Built-in (protected files, forbidden deps) | N/A | N/A |

## How It Works

```
USER
 │ "Build a TODO REST API with express"
 ▼
┌──────────────────────────────────────────┐
│           BRIEF COLLECTOR                 │
│  Collects: SCOPE + ANTI-SCOPE            │
│  Writes: MISSION.md                      │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│           ORCHESTRATOR                    │
│  ┌──────────┐ ┌───────────┐ ┌─────────┐ │
│  │ Planner  │ │ Evaluator │ │Escalator│ │
│  └────┬─────┘ └─────┬─────┘ └────┬────┘ │
│       │             │             │      │
│  Plan tasks    Check output   Ask human  │
└───────┬─────────────┬─────────────┬──────┘
        ▼             ▼             ▼
┌──────────────────────────────────────────┐
│           AGENT RUNNER                    │
│  claude --print + memory context          │
│  Spawns Claude Code with full memory      │
│  Retry loop: max 3 → escalate            │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│           MEMORY LAYER                    │
│                                          │
│  MISSION.md ──── immutable (human only)  │
│  ARCHITECTURE.md ── slow-changing        │
│  DECISIONS.md ──── append-only log       │
│  STATE.md ──────── live project state    │
└──────────────────────────────────────────┘
```

### The Loop

1. **Brief** → User describes what to build (scope + anti-scope)
2. **Plan** → Orchestrator creates task graph
3. **Execute** → Agent runs with full memory context injected
4. **Evaluate** → Real checks (tsc, npm test) + anti-scope validation
5. **Accept / Retry / Escalate** → Auto-retry up to 3x, then ask human
6. **Update** → DECISIONS.md + STATE.md updated after every task

## Quick Start

### Option A: npx (no install)

```bash
cd your-project
npx project-consciousness init     # interactive brief collection
npx project-consciousness run      # orchestrator starts
```

### Option B: Global install

```bash
npm install -g project-consciousness
cd your-project
pc init       # interactive brief → creates MISSION.md, ARCHITECTURE.md, etc.
pc run        # orchestrator reads MISSION.md and starts working
pc status     # show STATE.md
pc log        # show DECISIONS.md
```

### Option C: Clone & build

```bash
git clone https://github.com/BarisSozen/project-consciousness.git
cd project-consciousness
npm install
npm run build
```

### API Key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or copy .env.example → .env
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `pc init` | Interactive brief collection → creates 4 memory files |
| `pc run [brief]` | Start orchestrator (reads MISSION.md if no brief given) |
| `pc run "Build X"` | Start orchestrator with inline brief |
| `pc status` | Show current STATE.md |
| `pc log` | Show DECISIONS.md |
| `pc help` | Help message |

### Programmatic Usage

```typescript
import { BriefCollector } from 'project-consciousness/brief';
import { MemoryLayer } from 'project-consciousness/memory';
import { Orchestrator } from 'project-consciousness/orchestrator';
```

## Memory Files

| File | Changes | Who Writes | Purpose |
|------|---------|------------|---------|
| `MISSION.md` | Never (immutable) | Human only | Why this project exists, success criteria, anti-scope |
| `ARCHITECTURE.md` | Rarely | Approved changes | Technical decisions, stack, design principles |
| `DECISIONS.md` | Every decision | Append-only | Chronological decision log with rationale |
| `STATE.md` | Every task | Orchestrator | Current phase, active/completed/blocked tasks |

## Project Structure

```
src/
├── memory/          # Memory Layer — reads/writes the 4 files
│   └── memory-layer.ts
├── orchestrator/    # Plan → Execute → Evaluate → Escalate
│   ├── orchestrator.ts
│   ├── planner.ts
│   ├── evaluator.ts
│   └── escalator.ts
├── agent/           # Claude Code process spawning
│   ├── agent-runner.ts
│   ├── process-spawner.ts
│   ├── context-builder.ts
│   └── output-parser.ts
├── brief/           # SCOPE + ANTI-SCOPE collection
│   └── brief-collector.ts
├── types/           # All TypeScript interfaces
│   └── index.ts
└── index.ts         # CLI entry point
```

## Tests

```bash
npm test                    # all tests
npx vitest run tests/todo.test.ts   # specific test
SKIP_E2E=1 npm test         # skip real Claude CLI tests
```

**Current: 111+ tests across 11 suites** — memory, orchestrator, evaluator, agent runner, brief collector, calculator, TODO API, E2E integration.

## Evaluator — Real Checks

The evaluator doesn't just ask an LLM if the code is good. It runs **real commands**:

| Stack | Checks |
|-------|--------|
| TypeScript/Node | `tsc --noEmit`, `vitest run <agent-files>`, `eslint` |
| React | `tsc`, `vitest`, `npm run build`, `eslint` |
| Python | `pytest`, `mypy`, `flake8` |
| Go | `go build`, `go test`, `go vet` |

Plus **anti-scope enforcement**: if the agent touches a protected file or imports a forbidden dependency → automatic `FAIL` + escalation.

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Run tests (`npm test`)
4. Ensure TypeScript compiles (`npx tsc --noEmit`)
5. Commit with conventional commits (`feat:`, `fix:`, `docs:`)
6. Open a PR

### Design Principles

1. **Memory-First** — Every decision leaves a trace in the files
2. **Fail-Safe** — When in doubt, ask the human
3. **Append-Only Log** — DECISIONS.md is never edited, only appended
4. **Minimal Complexity** — File system is enough, no database
5. **Human-Readable** — All state is markdown, humans can read it directly
6. **Composable** — Sits on top of GSD-2, doesn't replace it

## License

MIT
