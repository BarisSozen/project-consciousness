# CSNS vs Claude (Manual) vs CodeRabbit vs Augment Code

> How four approaches to code understanding compare — and how CSNS can learn from each.

---

## The Four Approaches

| | **CSNS** | **Claude (Manual)** | **CodeRabbit** | **Augment Code** |
|---|---|---|---|---|
| **What it is** | Standalone CLI tool — build + audit + score | Human expert reading files + reasoning | PR-triggered AI review bot | IDE-embedded AI with persistent codebase index |
| **Trigger** | On-demand: `/audit`, `/trace`, post-build | Human decides what to read | Every PR automatically | Continuous — always indexing |
| **Scope** | Whole project snapshot | Selected critical files | PR diff + surrounding context | Entire codebase (400K+ files) |
| **Output** | Health score 0–100, violations, patterns, data flows | Prose report with prioritized fixes | PR comments (inline + summary) | Chat answers, code suggestions, PR reviews |

---

## Detailed Comparison

### 1. Context Gathering

| | CSNS | Claude | CodeRabbit | Augment |
|---|---|---|---|---|
| **Method** | Regex scan all `.ts` files, build import graph | Read specific files on demand | Clone repo into sandbox, build code graph, run scripts | Persistent semantic index, real-time updates |
| **Context window** | Unlimited (file system) | ~200K tokens per conversation | Full repo clone + AI-generated analysis scripts | 200K token Context Engine, indexes 400K+ files |
| **History awareness** | DECISIONS.md cross-check | Manual git log reading | PR history, linked issues (Jira/Linear) | Commit history, cross-repo dependencies |
| **Cross-file** | Import/export graph edges | Human traces imports mentally | Code graph + AI scripts (grep, ast-grep) | Semantic dependency graph, auto-updated |

**CSNS gap:** No git history, no issue tracker integration, no AST parsing (regex only).

### 2. Analysis Depth

| | CSNS | Claude | CodeRabbit | Augment |
|---|---|---|---|---|
| **Structural** | ✅ Layer classification, data flow chains, pattern detection | ✅ Same, but manual | ✅ Code graph analysis | ✅ Architectural pattern understanding |
| **Semantic** | ⚠️ LLM-optional (graph + summaries) | ✅ Deep — reads actual logic, traces execution paths | ✅ Reasoning models trace logic, edge cases | ✅ 200K context enables cross-service reasoning |
| **Security** | ❌ No security checks | ✅ JWT analysis, CSP audit, secret handling | ✅ Vulnerability detection, CVE checking | ⚠️ Focuses on correctness over security |
| **Runtime** | ✅ HTTP probing, server log analysis | ❌ No runtime | ✅ Can execute analysis scripts in sandbox | ❌ Static analysis only |
| **Decision archaeology** | ✅ DECISIONS.md + ARCHITECTURE.md cross-check | ✅ Manual, but deeper understanding | ❌ No project decision awareness | ❌ No decision tracking |
| **Smart acknowledgement** | ✅ Design decision vs bug distinction | ✅ Human judgment | ❌ No — flags everything equally | ❌ No — relies on custom instructions |

**CSNS unique strengths:** Decision archaeology, acknowledged violations, health scoring, runtime probing.
**CSNS gaps:** No security scanning, no AST-level analysis, no execution path tracing.

### 3. Timing & Workflow

| | CSNS | Claude | CodeRabbit | Augment |
|---|---|---|---|---|
| **When** | On-demand (`/audit`) or post-build | When human decides | Every PR (pre-merge) | Always (IDE background) |
| **Speed** | 3–10 seconds | 20–60 minutes | 10–20 minutes per PR | Sub-second for queries, minutes for reviews |
| **Automation** | ✅ CLI + build loop | ❌ Manual | ✅ Fully automated on PR | ✅ Background indexing |
| **CI integration** | `csns audit` in CI pipeline | ❌ | ✅ Native GitHub/GitLab | ⚠️ IDE-focused, PR review separate |
| **Fix generation** | ✅ AuditGate generates fix TaskDefinitions | ❌ Writes recommendations | ⚠️ Suggests fixes in comments | ✅ Agent implements fixes |

**CSNS gap:** No PR-level review (only whole-project audit), no IDE integration.

### 4. False Positive Management

| | CSNS | Claude | CodeRabbit | Augment |
|---|---|---|---|---|
| **Rate** | ~30% initially → ~5% after calibration | ~0% (human judgment) | Varies — "most talkative" per benchmarks | Lower noise due to deeper context |
| **Learning** | Pattern-based acknowledgement rules | N/A | "Learnings" from user feedback on comments | Custom instructions stored in repo |
| **Suppression** | `acknowledged: true` + `acknowledgeReason` | Human skips irrelevant | React 👎 to teach, `.coderabbit.yaml` rules | Guidelines in repo config |

**CSNS strength:** Automatic acknowledgement based on detected patterns — no manual training needed.

---

## What CSNS Should Learn From Each

### From Claude (Manual Audit)

| Finding Claude caught, CSNS missed | How to add it |
|---|---|
| **JWT secret crash risk** (`process.env.X!`) | **Security scanner**: regex for `process.env\[.*\]!` non-null assertions without prior validation |
| **Cookie/JWT TTL mismatch** | **Cross-file value checker**: extract numeric constants across files, flag mismatches in related values |
| **CSP `unsafe-inline`** | **Security header analyzer**: parse CSP directives, flag known-weak patterns |
| **Dead code (unreachable function)** | **Call graph analysis**: build function call graph, find functions never called |
| **Unbounded payload size** | **Data flow constraint checker**: flag `JSON.stringify(untrusted)` without size guard |
| **Env parse without try/catch** | **Error handling scanner**: `JSON.parse(process.env.X)` without surrounding try/catch |

### From CodeRabbit

| CodeRabbit capability CSNS lacks | How to add it |
|---|---|
| **PR-level diff review** | Add `/review` command — takes a git diff, analyzes only changed files against existing codebase |
| **Issue tracker integration** | Read linked GitHub issues/Jira tickets, verify PR addresses requirements |
| **Verification scripts** | Generate and execute analysis scripts (ast-grep, custom validators) in sandbox |
| **Learning from feedback** | Store user 👍/👎 reactions to violations, adjust confidence thresholds over time |
| **AST-based analysis** | Replace regex with `ast-grep` or TypeScript compiler API for precise parsing |

### From Augment Code

| Augment capability CSNS lacks | How to add it |
|---|---|
| **Persistent semantic index** | Build and cache the import graph — only re-scan changed files on subsequent runs |
| **200K+ token context** | Already unlimited (file system), but LLM semantic pass could batch better |
| **Cross-repo awareness** | Support monorepo + multi-repo scanning — follow workspace references |
| **Commit history analysis** | `git log` integration — detect files that change together, find regression-prone areas |
| **Real-time IDE feedback** | LSP server or VS Code extension that shows violations inline as you type |

---

## Improvement Roadmap for CSNS

### Phase 1: Security Layer (High Impact, Medium Effort)

```
src/agent/tracer/security-scanner.ts
```

| Check | Pattern | Severity |
|---|---|---|
| Non-null env assertion | `process.env\[.*\]!` without prior `if (!X) throw` | MEDIUM |
| JSON.parse without try/catch | `JSON.parse(process.env` not wrapped in try | MEDIUM |
| Hardcoded secrets | `/secret|password|token|key/i = ['"](?!process\.env)` | CRITICAL |
| SQL string concatenation | `` `...${` `` inside `query(` calls | CRITICAL |
| CSP weak directives | `unsafe-inline`, `unsafe-eval` in CSP strings | LOW |
| Missing CORS origin | `cors({ origin: '*' })` or `cors()` without origin | MEDIUM |
| Unvalidated redirect | `res.redirect(req.query` or `req.params` | MEDIUM |
| Exposed stack traces | `res.send(err.stack)` or `res.json({ error: err })` | LOW |

### Phase 2: AST-Level Analysis (High Impact, High Effort)

Replace regex with TypeScript compiler API:
```typescript
import ts from 'typescript';
// Parse actual AST → precise import/export resolution
// Function call graph → dead code detection
// Type flow → interface drift detection
```

Benefits:
- Zero false positives on import classification
- Function-level call graph (not just file-level)
- Type compatibility checking across files

### Phase 3: PR Review Mode (Medium Impact, Medium Effort)

```
csns review              # reviews staged changes
csns review --pr 42      # reviews a GitHub PR
```

- Read git diff
- Identify affected files + their dependents
- Run targeted audit on changed + impacted files only
- Output: PR comment format (markdown with inline code refs)

### Phase 4: Persistent Index + Incremental (Performance)

```
csns index              # builds/updates .csns/index.json
csns audit --incremental # only re-analyzes changed files
```

- Cache import graph, classifications, patterns
- On re-run: only scan files modified since last index
- 530-file project: 3s → <0.5s for incremental

### Phase 5: Cross-File Value Checker (Unique Differentiator)

The thing nobody else does well:
```
csns> /audit

⚠️ VALUE MISMATCH:
   web/api/auth/refresh/route.ts:63  →  maxAge: 3600    (1 hour)
   backend/auth-service/token.ts:22  →  TTL: '15m'      (15 min)
   These values should match — cookie outlives the JWT by 45 minutes.
```

Track related constants across files:
- Token TTLs ↔ Cookie maxAge
- Rate limit values ↔ Redis TTLs
- Port numbers ↔ Service URLs
- Schema field names ↔ DB column names

### Phase 6: IDE Extension (Long-term)

VS Code extension:
- Shows health score in status bar
- Inline violation annotations
- "Explain this architecture" command
- Real-time as-you-type violation detection

---

## Where Each Tool Wins

| Scenario | Winner | Why |
|---|---|---|
| "Score this project's architecture" | **CSNS** | Only tool that produces a numeric health score with acknowledged vs real violations |
| "Review this PR before merge" | **CodeRabbit** | Purpose-built for PR review with inline comments |
| "Explain how auth flows through 12 services" | **Augment** | 200K context engine holds entire architecture |
| "Find security vulnerabilities" | **Claude (manual)** | Deep reasoning about JWT, CSP, crypto, auth flows |
| "Verify decisions are implemented" | **CSNS** | Decision archaeology is unique to CSNS |
| "Detect design decisions vs bugs" | **CSNS** | Smart acknowledgement is unique to CSNS |
| "Onboard new developer to codebase" | **Augment** | Persistent index + natural language Q&A |
| "Enforce coding standards on every PR" | **CodeRabbit** | Automated, configurable, learns from feedback |

---

## The Ideal Stack

```
Augment Code (always-on)     — IDE context, code generation, Q&A
    ↓ writes code
CodeRabbit (every PR)        — automated review, catches bugs before merge
    ↓ approved & merged
CSNS /audit (post-merge)     — architecture health, decision compliance, data flow
    ↓ findings → issues
Claude (quarterly)           — deep security audit, business logic review
```

CSNS's unique position: **the only tool that understands project memory (decisions, architecture, mission) and produces an objective health score.** No other tool does decision archaeology or acknowledged-vs-real violation distinction.
