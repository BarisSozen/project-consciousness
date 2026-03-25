# Mission Alignment Filters — Detailed Filtering Logic

This reference explains how to evaluate each audit finding against the project's purpose, architecture, and decision history.

## Table of Contents

1. [The Three Filters](#the-three-filters)
2. [Filter 1: Mission Alignment](#filter-1-mission-alignment)
3. [Filter 2: Architecture Coherence](#filter-2-architecture-coherence)
4. [Filter 3: Decision Consistency](#filter-3-decision-consistency)
5. [Composite Scoring](#composite-scoring)
6. [Project Phase Modifiers](#project-phase-modifiers)
7. [Non-CSNS Projects](#non-csns-projects)

---

## The Three Filters

Every finding passes through three independent filters. Each filter produces a signal:

- **PASS** — The finding is relevant through this lens
- **NEUTRAL** — The filter doesn't have an opinion
- **BLOCK** — The finding should be suppressed (acknowledged)

A finding needs at least one PASS to become actionable. A single BLOCK from any filter sends it to ACKNOWLEDGE (unless it's a security finding — security always overrides).

```
Finding → [Mission Filter] → PASS/NEUTRAL/BLOCK
        → [Architecture Filter] → PASS/NEUTRAL/BLOCK
        → [Decision Filter] → PASS/NEUTRAL/BLOCK

Any BLOCK → ACKNOWLEDGE (unless security)
All NEUTRAL → MONITOR (no strong signal either way)
Any PASS → Classify as OPERATE/TREAT based on severity
```

---

## Filter 1: Mission Alignment

### Input Required
- MISSION.md (or equivalent purpose documentation)
- The specific finding

### Evaluation Questions

**Q1: Does this finding block a stated success criterion?**

Read the SUCCESS CRITERIA section of MISSION.md. For each criterion, check:
- Does the finding directly prevent this criterion from being met?
- Example: Criterion says "npm test passes" and finding is a test failure → PASS (high)
- Example: Criterion says "GET /todos works" and finding is a naming inconsistency → NEUTRAL

**Q2: Does this finding involve something in ANTI-SCOPE?**

Check if the finding relates to:
- A banned dependency → PASS (something in anti-scope exists in code)
- An immutable file that was modified → PASS (critical violation)
- A feature that's out of scope → PASS (scope creep detected)

**Q3: Does this finding align with the project's identity?**

Compare the finding against the "Identity" dimension:
- CLI tool finding layer-skip in API handlers → weighted differently than in a microservice
- "No DB" project finding database-related code → PASS (identity violation)
- In-memory-only project finding filesystem persistence → depends on MISSION.md

**Q4: Does this finding affect the target user?**

Consider who uses this:
- Developer-facing tool: API consistency matters more than UI polish
- End-user-facing app: UX-related findings weight higher
- Infrastructure tool: Reliability findings weight higher

### Signal Output

| Condition | Signal | Strength |
|-----------|--------|----------|
| Blocks success criterion | PASS | HIGH |
| Violates anti-scope | PASS | HIGH |
| Contradicts project identity | PASS | MEDIUM |
| Affects target user experience | PASS | MEDIUM |
| Unrelated to mission | NEUTRAL | — |
| Explicitly in-scope trade-off | BLOCK | — |

---

## Filter 2: Architecture Coherence

### Input Required
- ARCHITECTURE.md (or inferred architecture from audit results)
- File classifications (layer assignments)
- Data flow chains
- The specific finding

### Evaluation Questions

**Q1: Does this finding violate the documented architecture?**

Compare against ARCHITECTURE.md sections:
- Layer architecture: Does the finding cross layer boundaries incorrectly?
- Module boundaries: Does it break stated independence between modules?
- Pattern choices: Does it use a different pattern than what's documented?

**Q2: Does this finding weaken structural integrity?**

Structural integrity = the degree to which the architecture constrains future changes in predictable ways.

- Circular dependency → Always weakens integrity (PASS)
- Layer skip → Weakens if it creates a shortcut others will copy (PASS)
- Tight coupling → Weakens if modules should evolve independently (PASS)
- High blast radius type with no tests → Weakens safety net (PASS)

**Q3: Is the finding consistent with the detected architecture style?**

If the audit detected patterns (e.g., "Repository Pattern", "Middleware Chain"):
- Finding that breaks a detected pattern → PASS
- Finding that follows an alternative valid pattern → evaluate if intentional

**Q4: Would fixing this finding make the architecture more or less coherent?**

- Fix improves coherence → PASS
- Fix has no effect on coherence → NEUTRAL
- Fix would break a working convention → BLOCK (acknowledge instead)

### Signal Output

| Condition | Signal | Strength |
|-----------|--------|----------|
| Violates documented architecture | PASS | HIGH |
| Circular dependency | PASS | HIGH |
| Breaks detected pattern | PASS | MEDIUM |
| Weakens module boundaries | PASS | MEDIUM |
| Irrelevant to architecture | NEUTRAL | — |
| Matches project's actual convention | BLOCK | — |

---

## Filter 3: Decision Consistency

### Input Required
- DECISIONS.md (or equivalent decision log)
- Decision audit results from the audit report
- The specific finding

### Evaluation Questions

**Q1: Does this finding contradict an active decision?**

For each decision marked `status: active`:
- Does the finding directly violate what the decision prescribes?
- Example: D005 says "Zod for validation" → finding shows Joi usage → PASS

**Q2: Is there a relevant decision that's missing?**

If the finding reveals a pattern that should have been decided:
- Multiple implementations of the same concern (e.g., 3 different date libraries) → PASS
- Implicit convention without explicit decision → NEUTRAL (suggest creating one)

**Q3: Is the finding about a superseded or reverted decision?**

- Decision was superseded by a newer decision → Check new decision instead
- Decision was reverted → Code matching old decision is acceptable → BLOCK

**Q4: Does the finding suggest a decision needs updating?**

- >50% of code deviates from the decision → Decision might be stale
- Decision was made for constraints that no longer exist → Flag for review
- Signal: PASS (but prescribe "update decision" not "fix code")

### Signal Output

| Condition | Signal | Strength |
|-----------|--------|----------|
| Contradicts active decision | PASS | HIGH |
| Missing decision for divergent implementations | PASS | MEDIUM |
| Suggests stale decision | PASS | LOW (prescribe decision update) |
| Matches superseded decision | BLOCK | — |
| No relevant decision exists | NEUTRAL | — |

---

## Composite Scoring

After all three filters, combine signals:

### Priority Calculation

```
Priority = max(Mission.strength, Architecture.strength, Decision.strength)

If any filter = BLOCK and no security override:
  → ACKNOWLEDGE

If Priority = HIGH:
  → OPERATE candidate (verify with OPERATE criteria from taxonomy)

If Priority = MEDIUM:
  → TREAT candidate

If Priority = LOW or all NEUTRAL:
  → MONITOR candidate
```

### Conflict Resolution

When filters disagree:

| Mission | Architecture | Decision | Resolution |
|---------|-------------|----------|------------|
| PASS | PASS | PASS | OPERATE (strong consensus) |
| PASS | NEUTRAL | NEUTRAL | Classify by mission strength |
| NEUTRAL | PASS | NEUTRAL | TREAT (architecture-only concern) |
| NEUTRAL | NEUTRAL | PASS | TREAT (decision alignment concern) |
| PASS | BLOCK | NEUTRAL | ACKNOWLEDGE if convention is strong; otherwise TREAT with note |
| BLOCK | PASS | NEUTRAL | ACKNOWLEDGE (mission explicitly allows it) |
| PASS | PASS | BLOCK | Unusual — investigate. Decision may need updating |

---

## Project Phase Modifiers

The project's current phase adjusts thresholds:

### Prototype / MVP Phase
```
OPERATE threshold: Only security + mission-blocking
TREAT threshold: Raised — most architecture issues become MONITOR
MONITOR threshold: Lowered — captures more for later
ACKNOWLEDGE threshold: Broader — more things are "OK for now"
```

### Active Development (pre-1.0)
```
OPERATE threshold: Security + mission + compounding damage
TREAT threshold: Standard — architecture alignment matters now
MONITOR threshold: Standard
ACKNOWLEDGE threshold: Standard
```

### Pre-Production
```
OPERATE threshold: Lowered — more things become urgent
TREAT threshold: Lowered — batch and fix before launch
MONITOR threshold: Raised — fewer things can wait
ACKNOWLEDGE threshold: Stricter — only truly intentional trade-offs
```

### Production / Maintenance
```
OPERATE threshold: Security + reliability + data integrity
TREAT threshold: Balanced with release cycle
MONITOR threshold: High — proactive watching
ACKNOWLEDGE threshold: Very strict — must be documented
```

---

## Non-CSNS Projects

For projects that don't use the CSNS 4-file memory system, map findings to equivalent sources:

### Finding Project Intent

| CSNS File | Equivalent Sources |
|-----------|--------------------|
| MISSION.md | README.md "About" section, package.json description, CONTRIBUTING.md goals |
| ARCHITECTURE.md | docs/architecture.md, ADR files, .cursor/rules, technical RFC documents |
| DECISIONS.md | ADR directory (Architecture Decision Records), CHANGELOG.md rationale sections |
| STATE.md | GitHub project boards, JIRA epic status, recent git activity pattern |

### When No Intent Documentation Exists

If the project has zero documentation about its purpose:

1. **Infer from code**: What does the entry point do? What's the primary export?
2. **Infer from dependencies**: The dependency list reveals intent (express = web server, ethers = blockchain)
3. **Infer from tests**: What do the tests verify? That's what matters to the author
4. **Ask the user**: "What is this project trying to be? I need this context to prioritize findings."

Never skip the intent-gathering step. Without it, all findings are equally weighted, which defeats the purpose of surgical correction.
