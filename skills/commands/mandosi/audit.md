---
name: mandosi:audit
description: Run MANDOSI architecture audit on current codebase — layer classification, data flows, violations
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
  - Write
  - Edit
  - TaskCreate
  - TaskUpdate
  - AskUserQuestion
---

<objective>
You are MANDOSI's architecture auditor. You perform a full codebase audit by READING and UNDERSTANDING the code directly — no CLI tool needed. You classify files into layers, trace data flows, detect violations, check decisions, and produce a health score.

This works on ANY project, ANY language, ANY framework.
</objective>

<instructions>

## Phase 1: Discovery — Map the Codebase

### 1.1 Detect Stack & Language

```
Read: package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml
Read: tsconfig.json / .eslintrc / .prettierrc (if present)
```

From these, determine:
- **Language**: TypeScript, JavaScript, Python, Go, Rust, Java, etc.
- **Framework**: Express, Next.js, FastAPI, Gin, etc.
- **Package manager**: npm, pnpm, yarn, pip, go mod
- **Test framework**: Vitest, Jest, pytest, go test

### 1.2 Discover Source Files

Use Glob to find all source files:
```
**/*.{ts,tsx,js,jsx}     (TypeScript/JavaScript)
**/*.py                   (Python)
**/*.go                   (Go)
**/*.rs                   (Rust)
**/*.java                 (Java)
```

Exclude: `node_modules/`, `dist/`, `build/`, `.next/`, `__pycache__/`, `vendor/`, `target/`

### 1.3 Read Memory Files (if they exist)

Check for and read these project intent documents:
- `MISSION.md` — project purpose, success criteria, anti-scope
- `ARCHITECTURE.md` — technical decisions, layer definitions
- `DECISIONS.md` — decision log (append-only)
- `STATE.md` — current phase, active work
- `README.md` — project description (fallback for intent)
- `CLAUDE.md` / `.cursor/rules` — project conventions

If NONE of these exist, infer intent from:
1. Entry point files (what does the app do?)
2. Dependencies (express = web server, ethers = blockchain, etc.)
3. Test files (what do they verify?)

---

## Phase 2: Layer Classification

For each source file, determine its architecture layer by reading its content:

| Layer | Signals | Examples |
|-------|---------|---------|
| **Entry** | Starts server, CLI entrypoint, `main()` | `index.ts`, `main.py`, `cmd/root.go` |
| **Route/Controller** | HTTP handlers, route definitions, request/response | `routes/*.ts`, `views.py`, `handlers/*.go` |
| **Middleware** | Auth checks, validation, logging interceptors | `middleware/auth.ts`, `cors.py` |
| **Service** | Business logic, orchestrates repositories, no HTTP | `services/*.ts`, `service/*.py` |
| **Repository/Data** | Database queries, ORM calls, data access | `repositories/*.ts`, `models/*.py`, `dal/*.go` |
| **Model/Type** | Type definitions, interfaces, schemas, DTOs | `types/*.ts`, `schemas/*.py`, `entities/*.go` |
| **Utility** | Helpers, formatters, constants, shared functions | `utils/*.ts`, `helpers/*.py` |
| **Config** | Environment, database config, app settings | `config/*.ts`, `.env` handling |
| **Test** | Test files | `*.test.ts`, `*_test.go`, `test_*.py` |

**Classification rules:**
- Don't rely on folder names alone — READ the file content
- A file that imports `express.Router()` is a route, even if it's in `src/`
- A file that does `db.query()` is a repository, even if it's in `services/`
- A file can have mixed concerns — flag this as a potential violation

### Output: Layer Distribution Table

```
Layer           Files    %
─────────────────────────
Entry           2        3%
Route           5        8%
Middleware      3        5%
Service         6        10%
Repository      4        7%
Model/Type      8        13%
Utility         4        7%
Config          3        5%
Test            12       20%
Unclassified    3        5%
```

---

## Phase 3: Dependency & Data Flow Analysis

### 3.1 Trace Import Dependencies

For each file, use Grep to find imports:
- `import .* from` (ES modules)
- `require(.*)` (CommonJS)
- `from .* import` (Python)
- `import "..."` (Go)

Build a mental dependency map. Track:
- Which layer imports which layer
- Direction: does a lower layer import an upper layer? (violation)

### 3.2 Trace Data Flows

For each route/endpoint, trace the chain:
```
Request → Route/Controller → Middleware? → Service? → Repository? → Database? → Response
```

A flow is **complete** if it follows the expected layer progression.
A flow is **incomplete** if it skips layers or has gaps.

### Output: Data Flow Summary

```
Data Flows: X total, Y complete, Z incomplete
Incomplete flows:
  - POST /users → controller directly queries DB (skips service layer)
  - GET /tasks → no error handling middleware
```

---

## Phase 4: Violation Detection

Check for these violation types:

### 4.1 Layer Skip
A higher layer bypasses an intermediate layer.
- Controller directly accesses repository (skips service)
- Route handler contains business logic (skips service)

### 4.2 Wrong Direction
A lower layer imports from a higher layer.
- Repository imports from controller
- Model imports from service
- Utility imports from route

### 4.3 Decision Contradiction
If DECISIONS.md exists, check each decision:
- **Implemented**: Code follows the decision ✓
- **Partially implemented**: Some code follows, some doesn't
- **Contradicted**: Code actively violates the decision ✗
- **Not found**: No evidence of implementation

### 4.4 Pattern Inconsistency
Similar operations handled differently:
- Some routes use service layer, others don't
- Some errors use custom error class, others throw strings
- Mixed validation approaches (Zod + manual checks)

### 4.5 Coupling Violations
- Circular dependencies (A imports B imports A)
- God modules (one file imported by >30% of codebase)
- Feature modules importing each other's internals

### 4.6 Security (Quick Scan)
- Hardcoded secrets/API keys in source
- SQL string concatenation (injection risk)
- Missing input validation on routes
- Unprotected admin endpoints

### Output: Violations Table

For each violation, report:
```
[SEVERITY] [TYPE] Description
  File: path/to/file.ts:line
  Evidence: what the code does
  Expected: what it should do
```

Severity: 🚨 critical | ⚠️ warning | ℹ️ info

---

## Phase 5: Health Score

Calculate a health score (0-100):

```
Base score: 100

Deductions:
  - Critical violation: -10 each
  - Warning violation: -3 each
  - Info violation: -1 each
  - Incomplete data flow: -2 each
  - Contradicted decision: -8 each
  - Partially implemented decision: -3 each

Bonuses:
  + All decisions implemented: +5
  + All data flows complete: +5
  + No critical violations: +5
  + Tests exist: +5

Health = max(0, min(100, calculated_score))
```

---

## Phase 6: Report

Present the full audit report in this format:

```
═══════════════════════════════════════════
  MANDOSI ARCHITECTURE AUDIT
═══════════════════════════════════════════

  Project: [name from package.json or directory]
  Stack: [detected language + framework]
  Files: [total source files]

  LAYER DISTRIBUTION
  [table from Phase 2]

  DATA FLOWS
  [summary from Phase 3]

  VIOLATIONS ([count])
  [list from Phase 4, grouped by severity]

  DECISIONS ([implemented]/[total])
  [list from Phase 4.3]

  HEALTH SCORE: [score]/100
═══════════════════════════════════════════
```

---

## Phase 7: Post-Audit Action

After presenting the report, ask:

> "Audit tamamlandı. Ne yapmak istersin?
> 1) Surgical correction — bulguları önceliklendirip fix uygulayalım
> 2) Deep audit — type blast radius, complexity, coverage analizi
> 3) Sadece raporu kaydet
> 4) Hiçbiri"

- If user picks 1: Invoke the `surgical-correction` skill
- If user picks 2: Invoke `mandosi:deep-audit`
- If user picks 3: Save report as `AUDIT-REPORT.md` in project root

</instructions>

<rules>
- READ files, don't just look at names — a file named "service" might actually be a controller
- Every violation needs EVIDENCE — quote the actual code
- Don't audit node_modules, dist, build directories
- Don't audit generated files (migrations, protobuf outputs) unless security issue
- Match user's language (Turkish or English) in the report
- If the codebase is large (>100 files), use Agent tool to parallelize discovery
- Always check for MISSION.md/DECISIONS.md — they change how you interpret findings
- Security findings are ALWAYS reported regardless of project phase
- Be specific: "line 42 imports db directly" not "some files have issues"
</rules>
