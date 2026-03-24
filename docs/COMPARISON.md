# Project Consciousness vs Paperclip vs GSD (pi)

> Three tools, three philosophies, three different problems solved.

---

## One-Line Summary

| Tool | What It Is |
|------|-----------|
| **Project Consciousness** | Memory-first orchestrator that never forgets why a project exists |
| **Paperclip** | Business operating system for zero-human AI companies |
| **GSD (pi)** | Developer productivity harness — your AI coding companion |

---

## The Core Difference

```
                    Scope
                      │
    Business ─────────┼──────────── Paperclip
    (company)         │             "Run a company made of agents"
                      │
    Project ──────────┼──────────── Project Consciousness
    (codebase)        │             "Build this, remember why, verify it works"
                      │
    Task ─────────────┼──────────── GSD (pi)
    (developer)       │             "Help me code this right now"
                      │
```

**Paperclip** thinks in org charts, budgets, and quarterly goals.
**Project Consciousness** thinks in missions, architectural decisions, and test results.
**GSD** thinks in files, diffs, and terminal commands.

---

## Detailed Comparison

### 1. Who Is It For?

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Primary user** | Solo dev / small team building a project | Founder / manager running AI-powered business | Individual developer in the IDE |
| **Metaphor** | A senior engineer with perfect memory | A CEO dashboard for AI employees | A pair programmer sitting next to you |
| **Scale** | 1 project at a time | Multiple companies, many agents | 1 developer, 1 session |

### 2. Memory & State

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **State storage** | 4 markdown files (MISSION, ARCHITECTURE, DECISIONS, STATE) | PostgreSQL database | Session-scoped (ephemeral) |
| **Persistence** | Files survive reboots, git-tracked | Full DB persistence across heartbeats | Lost between sessions (unless saved) |
| **Memory model** | Append-only decisions log, immutable mission | Ticket threads, audit trails, agent state | Context window + CLAUDE.md rules |
| **"Why are we doing this?"** | MISSION.md — read before every task | Goal ancestry — task traces back to company mission | Not tracked — you tell it each time |

### 3. Agent Model

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Agent types** | coder, reviewer, tester, documenter, tracer | CEO, CTO, Engineer, Designer, Marketer — any role | scout, planner, worker, reviewer (subagents) |
| **How agents run** | CLI spawn (claude --print) per task | Heartbeat-scheduled, event-triggered | Inline in conversation, or subagent delegation |
| **Agent awareness** | Every agent reads 4 memory files before working | Context flows from company → project → task | Context window of current conversation |
| **Multi-model** | ✅ Anthropic, OpenAI, Ollama | ✅ Any agent runtime (Claude, Codex, scripts) | Anthropic-native (Claude) |

### 4. Orchestration

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Planning** | LLM generates TaskPlan from brief + memory | CEO agent decomposes goals into tasks | User decides, or planner subagent suggests |
| **Execution** | Parallel batches with dependency graph | Heartbeat cycles — agents wake, check work, act | Sequential conversation turns |
| **Evaluation** | 3-layer: real checks (tsc, test) + anti-scope + LLM scoring | Management agent reviews, approval gates | User reviews output, accepts or iterates |
| **Self-correction** | 3x auto-retry with feedback → escalation to human | Agent retries within budget, governance rollback | User asks for fix, agent retries |
| **Delegation** | Orchestrator assigns to typed agents | Hierarchical — CEO → CTO → Engineer | Explicit subagent delegation (scout → worker) |

### 5. Quality Control

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Automated checks** | tsc, vitest, HTTP endpoint testing, lint | Bring your own — Paperclip orchestrates, not reviews | User runs tests manually or via bash |
| **Anti-scope** | ✅ Protected files, forbidden deps, breaking changes enforced | ❌ Not code-aware — business-level governance | ❌ No automated scope enforcement |
| **Consistency scoring** | 0-1 scores for consistency, quality, mission alignment | Audit trail + approval gates | Not scored — conversational feedback |
| **Wiring analysis** | ✅ Tracer Agent (static + semantic + runtime) | ❌ Not a code analysis tool | ❌ No built-in project-wide analysis |

### 6. Human Interaction

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Interaction mode** | Brief → autonomous → escalation when stuck | Dashboard monitoring, approval gates | Real-time conversation |
| **When human is needed** | Only product questions + failed escalations | Approve hires, override strategy, budget decisions | Every step (human-in-the-loop) |
| **Autonomy level** | High — runs milestone-to-milestone automatically | Very high — agents work overnight on heartbeats | Low — responds to each user message |
| **UI** | CLI (terminal) | React web dashboard | TUI (terminal) |

### 7. Infrastructure

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Dependencies** | Node.js + 1 LLM API key | Node.js + PostgreSQL + agent runtimes | Node.js + Anthropic API |
| **Storage** | File system only (markdown) | PostgreSQL + file storage | File system (in-memory session) |
| **Deployment** | `npx project-consciousness init` | Self-hosted server + React UI | `npm install -g @anthropic-ai/claude-code` |
| **Multi-tenant** | ❌ Single project | ✅ Multiple companies, isolated | ❌ Single user session |
| **Cost control** | No built-in budget | ✅ Per-agent monthly budgets, circuit breakers | No built-in budget |

---

## What Each Tool Does NOT Do

### Project Consciousness does NOT:
- Run a business (no org charts, no budgets, no heartbeats)
- Replace a project management tool (no Jira/Linear integration)
- Work as a real-time coding assistant (it's autonomous, not interactive)
- Manage multiple projects simultaneously

### Paperclip does NOT:
- Understand your code (no tsc, no test runner, no static analysis)
- Enforce architectural decisions (no ARCHITECTURE.md, no anti-scope)
- Self-correct based on test failures (it orchestrates, agents review)
- Work as a coding tool — it's a management layer

### GSD (pi) does NOT:
- Remember across sessions (no persistent mission/decisions)
- Run autonomously (needs human at every step)
- Enforce project-wide consistency (no anti-scope, no evaluation loop)
- Scale to multi-agent teams (subagents are task-scoped)

---

## When to Use Which

| Scenario | Best Tool |
|----------|-----------|
| "Build me a todo API from scratch, test it, ship it" | **Project Consciousness** |
| "Run 5 AI agents building a SaaS while I sleep" | **Paperclip** |
| "Help me debug this function right now" | **GSD (pi)** |
| "I have a brief, make all technical decisions and code it" | **Project Consciousness** |
| "Manage an AI content team with budgets and approval gates" | **Paperclip** |
| "I need to edit 3 files and run tests" | **GSD (pi)** |
| "Find all wiring problems in my codebase" | **Project Consciousness** (Tracer) |
| "Coordinate 20 agents across 3 companies" | **Paperclip** |
| "Read this error, suggest a fix" | **GSD (pi)** |

---

## They Can Work Together

```
┌─────────────────────────────────────────┐
│  Paperclip (company level)               │
│  "Build MVP for URL shortener product"   │
│  Budget: $50/month, CEO + CTO + Engineer │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  Project Consciousness (project)    │ │
│  │  MISSION: URL shortener             │ │
│  │  Agent: coder → reviewer → tester   │ │
│  │  Memory: 4 markdown files           │ │
│  │                                     │ │
│  │  ┌─────────────────────────────┐    │ │
│  │  │  GSD / pi (task level)      │    │ │
│  │  │  "Fix this auth middleware" │    │ │
│  │  │  Human + AI pair-coding     │    │ │
│  │  └─────────────────────────────┘    │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- **Paperclip** is the company. It decides WHAT to build and WHO does it.
- **Project Consciousness** is the engineering team. It decides HOW to build it and VERIFIES it works.
- **GSD (pi)** is the individual developer. It writes and debugs the actual code.

---

## Architecture Philosophy

| | Project Consciousness | Paperclip | GSD (pi) |
|---|---|---|---|
| **Core belief** | "Agents forget. Files don't." | "One agent is an employee. Many agents are a company." | "The best AI is the one sitting next to you." |
| **Design principle** | Memory-first, fail-safe, append-only | Governance-first, budget-aware, multi-tenant | Conversation-first, tool-rich, extensible |
| **State model** | Immutable mission + evolving decisions | Persistent DB + audit trail | Ephemeral context window |
| **Failure mode** | Retry → escalate → pause (never silently fail) | Budget cap → agent pause → board override | User notices and asks for fix |
| **Trust model** | "Verify everything: types, tests, scope, mission alignment" | "Govern everything: approvals, budgets, audit" | "Trust the developer to check" |
