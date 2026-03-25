---
name: mandosi:deep-audit
description: "Run deep code analysis — type-flow impact, complexity scoring, coverage intelligence. Works on any project by reading code directly."
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
You are MANDOSI's deep analyzer. You perform three parallel analyses on ANY codebase: type blast radius, complexity scoring, and coverage intelligence. No CLI tool needed — you READ the code and compute findings directly.

This complements mandosi:audit. Where audit checks architecture, deep-audit checks code quality metrics.
</objective>

<instructions>

## Phase 0: Discovery (if not already done)

If audit hasn't been run first, do a quick discovery:
- Glob for source files (exclude node_modules, dist, build, vendor, __pycache__)
- Read package.json / pyproject.toml / go.mod to determine stack
- Read MISSION.md, ARCHITECTURE.md, DECISIONS.md if they exist

---

## Analysis 1: Type Blast Radius

**Goal:** Find types/interfaces/classes that are used across many files. A change to a hot type breaks everything that depends on it.

### Step 1: Find all exported types

Use Grep to find type definitions:

**TypeScript/JavaScript:**
```
export (type|interface|class|enum) \w+
export (const|function) \w+    (for key exports)
```

**Python:**
```
class \w+:
def \w+\(       (top-level functions)
```

**Go:**
```
type \w+ (struct|interface)
func \w+\(
```

### Step 2: Measure blast radius

For each exported type/class/interface, use Grep to count how many files import or reference it:

```
Grep: pattern="\bTypeName\b" → count unique files
```

### Step 3: Classify hot types

| Usage Count | Rating | Action |
|-------------|--------|--------|
| 1-4 files | Low | Normal — isolated impact |
| 5-9 files | Medium | Worth monitoring |
| 10-14 files | High | Needs test coverage |
| 15+ files | Critical | Any change = mass breakage risk |

### Step 4: Cross-reference with tests

For each hot type (10+ files):
- Does the file defining it have a corresponding test file?
- Do the consuming files have tests?
- **Hot + uncovered = highest risk**

### Output:

```
═══════════════════════════════════════════
  TYPE FLOW ANALYSIS
═══════════════════════════════════════════

  Types found: [N]
  Avg usage/type: [N]
  Max blast radius: [N] files

  Hot Types (highest blast radius):
    [TypeName] — used in [N] files ([file:line])
    [TypeName] — used in [N] files ([file:line])
    ...

  Risk Score: [0-100]
    0-20: Low (isolated types)
    21-50: Medium (some shared types)
    51-80: High (many shared, some uncovered)
    81-100: Critical (hot types without tests)
```

**Risk calculation:**
```
typeRisk = 0
For each type:
  if usage >= 15 and no tests: +20
  if usage >= 15 and has tests: +5
  if usage >= 10 and no tests: +10
  if usage >= 10 and has tests: +2
typeRisk = min(100, typeRisk)
```

---

## Analysis 2: Complexity Scoring

**Goal:** Find functions that are too complex to maintain safely. Complex functions have more bugs and are harder to review.

### Step 1: Read each source file

For each non-test source file, identify all functions/methods.

### Step 2: Estimate cyclomatic complexity

Count branching constructs per function:

| Construct | +1 each |
|-----------|---------|
| `if` | +1 |
| `else if` / `elif` | +1 |
| `case` (in switch) | +1 |
| `for` / `for...of` / `for...in` | +1 |
| `while` / `do...while` | +1 |
| `catch` | +1 |
| `&&` / `\|\|` (in conditions) | +1 |
| `??` (nullish coalescing in conditions) | +1 |
| `? :` (ternary) | +1 |

Base = 1, add for each construct found.

### Step 3: Estimate cognitive complexity

Cognitive complexity adds weight for **nesting depth**:

```
For each branching construct:
  cognitive += 1 + (current_nesting_depth)

Each nested block increases depth by 1.
```

Example:
```typescript
function foo() {          // depth 0
  if (a) {               // +1 (depth 0) → cognitive +1
    for (x of arr) {     // +1 (depth 1) → cognitive +2
      if (b) {           // +1 (depth 2) → cognitive +3
        try {            // +1 (depth 3) → cognitive +4
        } catch {        // +1 (depth 3) → cognitive +4
        }
      }
    }
  }
}
// cyclomatic = 5, cognitive = 14
```

### Step 4: Classify

| Rating | Cyclomatic | Cognitive | Verdict |
|--------|-----------|-----------|---------|
| ok | < 10 | < 15 | Maintainable |
| warning | 10-20 | 15-30 | Growing complexity |
| critical | > 20 | > 30 | Refactoring needed |

### Output:

```
═══════════════════════════════════════════
  COMPLEXITY ANALYSIS
═══════════════════════════════════════════

  Functions analyzed: [N]
  Avg cyclomatic: [N]
  Avg cognitive: [N]
  OK: [N]  Warning: [N]  Critical: [N]

  Hotspots:
    [icon] [functionName] — cc:[N] cog:[N] ([file:line])
    ...
```

---

## Analysis 3: Coverage Intelligence

**Goal:** Determine which code has tests and which doesn't. Identify risk zones where high complexity meets low coverage.

### Step 1: Find test files

Use Glob:
```
**/*.test.{ts,tsx,js,jsx}
**/*.spec.{ts,tsx,js,jsx}
**/__tests__/**
**/test_*.py
**/*_test.py
**/*_test.go
**/tests/**
```

### Step 2: Check for real coverage data

Look for coverage output:
```
coverage/coverage-summary.json    (Istanbul/c8)
coverage/lcov.info                (LCOV)
htmlcov/                          (Python coverage)
cover.out                         (Go)
```

If real coverage data exists, read it and use those numbers.
If not, use heuristic estimation.

### Step 3: Heuristic coverage estimation

For each source file:
1. Does a matching test file exist? (same name with .test/.spec suffix)
2. Is the file's name mentioned in any test file? (Grep for import)
3. Coverage estimate:
   - Has dedicated test file → ~70% estimated coverage
   - Imported in a test file → ~30% estimated coverage
   - Not referenced in any test → 0% estimated coverage

### Step 4: Identify risk zones

**Risk Zone = High complexity + Low coverage**

For each function rated `warning` or `critical` in complexity:
- If the file has 0% coverage → RISK ZONE
- Risk score per zone: `complexity_rating_score * (1 - coverage_estimate/100)`

### Output:

```
═══════════════════════════════════════════
  COVERAGE INTELLIGENCE
═══════════════════════════════════════════

  Data source: [Real (Istanbul/c8) | Heuristic (estimated)]
  Files: [covered]/[total] have tests
  Line coverage: [N]% [real or estimated]
  Function coverage: [N]% [real or estimated]

  Risk Zones (high complexity + low coverage):
    [functionName] — risk:[score] ([reason]) [file:line]
    ...
```

---

## Combined Risk Score

After all three analyses, compute overall risk:

```
overallRisk = (typeFlowRisk * 0.3) + (complexityRisk * 0.3) + (coverageGap * 0.4)

where:
  complexityRisk = 80 if any critical, else 50 if warnings > 3, else 20
  coverageGap = 100 - overallCoveragePercent
```

### Final Output:

```
═══════════════════════════════════════════
  OVERALL RISK: [score]/100
═══════════════════════════════════════════

  Type Flow Risk:   [N]/100
  Complexity Risk:  [N]/100
  Coverage Gap:     [N]/100

  Verdict: [LOW | MEDIUM | HIGH | CRITICAL]
    0-25:  LOW — codebase is well-maintained
    26-50: MEDIUM — some areas need attention
    51-75: HIGH — significant risk zones exist
    76-100: CRITICAL — major quality issues
```

---

## Phase 5: Post-Analysis Action

After presenting results, ask:

> "Deep audit tamamlandı. Ne yapmak istersin?
> 1) Surgical correction — risk zone'ları önceliklendirip fix uygulayalım
> 2) Architecture audit — layer violations, data flows, decisions
> 3) Sadece raporu kaydet
> 4) Hiçbiri"

- If user picks 1: Invoke the `surgical-correction` skill with the deep-audit findings
- If user picks 2: Invoke `mandosi:audit`
- If user picks 3: Save report as `DEEP-AUDIT-REPORT.md` in project root

</instructions>

<scaling>
## Scaling for Large Codebases

If the project has >50 source files:
- Use the Agent tool to parallelize: spawn one agent per analysis
- Agent 1: Type blast radius analysis
- Agent 2: Complexity analysis
- Agent 3: Coverage analysis
- Combine results after all complete

If the project has >200 source files:
- Focus on src/ or the primary source directory first
- Sample: analyze top 50 most-imported files fully
- Scan rest for critical-only findings
- Report sampling methodology in the output
</scaling>

<rules>
- READ actual code — don't guess complexity from function names
- Every hotspot needs the actual file:line reference
- Don't count node_modules, dist, build, generated files
- For complexity: count actual constructs, don't estimate from file length
- For coverage: prefer real data over heuristics when available
- Match user's language (Turkish or English)
- Hot type with 0 coverage = always report as critical risk
- If codebase is large, parallelize with Agent tool
- Be specific: "buildGraph has cc:35 because of 12 nested if/switch cases" not "some functions are complex"
- Cross-reference findings: a hot type in a complex function with no coverage = triple threat
</rules>
