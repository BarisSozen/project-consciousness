# Correction Taxonomy — Detailed Classification Guide

This reference provides the detailed decision logic for classifying audit findings into OPERATE / TREAT / MONITOR / ACKNOWLEDGE categories.

## Table of Contents

1. [Decision Tree](#decision-tree)
2. [OPERATE Criteria (Detailed)](#operate-criteria)
3. [TREAT Criteria (Detailed)](#treat-criteria)
4. [MONITOR Criteria (Detailed)](#monitor-criteria)
5. [ACKNOWLEDGE Criteria (Detailed)](#acknowledge-criteria)
6. [Edge Cases](#edge-cases)
7. [Escalation Matrix](#escalation-matrix)

---

## Decision Tree

For each finding, walk through this tree top-to-bottom. Stop at the first match.

```
Finding
  │
  ├─ Is it a security vulnerability?
  │   └─ YES → OPERATE (always, regardless of severity label)
  │
  ├─ Is it acknowledged? (matches documented decision, >80% convention, explicit annotation)
  │   └─ YES → ACKNOWLEDGE
  │
  ├─ Does it contradict MISSION.md success criteria?
  │   └─ YES → OPERATE
  │
  ├─ Does it contradict a DECISIONS.md entry?
  │   ├─ Decision is active → OPERATE
  │   └─ Decision is superseded → Check if new decision exists
  │       ├─ YES → ACKNOWLEDGE (old decision was replaced)
  │       └─ NO → TREAT (orphaned contradiction)
  │
  ├─ Does it create compounding damage? (circular dep, hot type gap, cascading coupling)
  │   └─ YES → OPERATE
  │
  ├─ Is the project in pre-production or production phase?
  │   ├─ YES → Does it affect reliability, performance, or observability?
  │   │   └─ YES → OPERATE
  │   └─ NO (prototype/dev) → Continue ↓
  │
  ├─ Does it weaken architecture coherence? (layer violations, boundary breaks)
  │   └─ YES → TREAT
  │
  ├─ Is it an inconsistency that doesn't affect function? (naming, style, minor coupling)
  │   └─ YES → TREAT (batch with similar items)
  │
  ├─ Could it become a problem if the codebase grows?
  │   └─ YES → MONITOR (with explicit escalation trigger)
  │
  └─ None of the above
      └─ MONITOR (low priority watch item)
```

---

## OPERATE Criteria

A finding is OPERATE when **delaying the fix makes the problem worse or blocks progress**.

### Category: Mission Violation
- Code contradicts explicit success criteria in MISSION.md
- Feature exists that is in ANTI-SCOPE
- Dependency exists that is in "banned dependencies" list
- Test suite fails (when "tests must pass" is a success criterion)

### Category: Decision Contradiction
- Active decision in DECISIONS.md is directly violated
- Example: D005 says "use Zod for validation" but code uses `joi.validate()`
- The decision system's credibility depends on enforcement

### Category: Security
- Any finding from security analyzers, regardless of rated severity
- SQL injection, XSS, CSRF, secrets in code, missing auth checks
- Unvalidated user input reaching dangerous sinks

### Category: Compounding Damage
- Circular dependencies (every new import increases blast radius)
- Hot types with no test coverage (type change breaks N files silently)
- Shared mutable state across module boundaries

### Category: Data Integrity
- Inconsistent data transformations in data flow chains
- Missing validation at system boundaries (API input, DB output)
- Type mismatches in hot paths (e.g., string where number expected)

---

## TREAT Criteria

A finding is TREAT when **it reduces quality but isn't causing active damage**. Can be batched.

### Category: Architecture Alignment
- Layer-skip violations (controller → repository, skipping service)
- Wrong-direction dependencies (model importing from controller)
- Services accessing other services' internals

### Category: Code Quality
- Complexity hotspots in non-critical paths (cognitive complexity > 15)
- Functions exceeding 50 lines in business logic (not config/setup)
- Duplicate logic across 3+ locations

### Category: Consistency
- Naming conventions not followed (but code works)
- Import style inconsistencies
- Error handling patterns inconsistent across similar operations

### Category: Incomplete Implementation
- Decisions marked "partially-implemented" in audit
- Data flow chains with gaps (non-critical paths)
- Missing error handling in non-critical paths

### Batching Guidelines
Group TREAT items that:
- Affect the same file or module
- Address the same type of violation
- Can be fixed in a single PR without risk

---

## MONITOR Criteria

A finding is MONITOR when **it's not a problem yet, but could become one**. The key is defining the **escalation trigger**.

### Category: Growth Risk
- Type with moderate blast radius (5-10 files) but stable usage
  - Escalation: Usage count crosses 15 files
- Function with warning-level complexity (cyclomatic 10-15)
  - Escalation: New conditions added, or bug reported in this function
- Module with moderate coupling
  - Escalation: New module needs to import from it

### Category: Coverage Gaps
- Low coverage on stable utility code that rarely changes
  - Escalation: Bug found in uncovered path, or function modified
- Integration tests missing for non-critical endpoints
  - Escalation: Endpoint starts handling production traffic

### Category: Technical Debt Signals
- TODOs in code that don't block anything
  - Escalation: Related code needs modification
- Deprecated API usage that still works
  - Escalation: Deprecation warning becomes error in next major version

---

## ACKNOWLEDGE Criteria

A finding is ACKNOWLEDGE when **it's intentional and documented**. These are design decisions, not bugs.

### Positive Acknowledgement (Documented)
- Finding matches a specific DECISIONS.md entry
  - Example: "D003: GraphQL resolvers directly access repositories" → layer-skip is intentional
- ARCHITECTURE.md explicitly mentions the trade-off
  - Example: "We accept coupling between auth and user modules for simplicity"
- Code has audit-ignore annotation with valid reason

### Convention-Based Acknowledgement
- >80% of similar code follows the same pattern
  - Example: 4 out of 5 controllers skip the service layer → this is the project's convention
- The "violation" is actually the project's chosen architecture
  - Example: "Flat architecture" projects legitimately skip layers

### Phase-Based Acknowledgement
- Finding is about coverage/quality in a prototype-phase project
- Finding is about performance in a project that isn't under load yet
- Finding is about scalability in a single-user tool

---

## Edge Cases

### Finding That Matches Multiple Categories

When a finding could be OPERATE or TREAT, use this tiebreaker:
1. Does it affect a data flow chain that serves a MISSION.md success criterion? → OPERATE
2. Is it in code that changes frequently (high churn)? → OPERATE (it'll compound)
3. Is it isolated to one module with no downstream effects? → TREAT

### Decision Contradiction Where Decision Might Be Wrong

If the code consistently deviates from a decision, consider:
1. Is the deviation in >50% of relevant code? → The decision might be outdated
2. Does the deviation produce better results? → Suggest updating DECISIONS.md
3. Prescription: "Update D005 to reflect actual practice, OR bring code into alignment with D005. Both are valid — but the current inconsistency is not."

### Finding in Generated or External Code

- Generated code (protobuf outputs, ORM migrations): ACKNOWLEDGE unless security issue
- Vendored dependencies: ACKNOWLEDGE (fix upstream or replace)
- Configuration files: Only OPERATE if security-relevant

---

## Escalation Matrix

| Current Level | Escalation Trigger | New Level |
|---------------|-------------------|-----------|
| MONITOR | Bug found in monitored area | TREAT |
| MONITOR | Complexity crosses critical threshold | TREAT or OPERATE |
| MONITOR | Usage count doubles | TREAT |
| TREAT | Blocks a new feature | OPERATE |
| TREAT | Causes a production incident | OPERATE |
| TREAT | Related OPERATE fix requires it | OPERATE (dependency) |
| ACKNOWLEDGE | Decision is reverted/superseded | Re-evaluate as new finding |
| ACKNOWLEDGE | Convention changes (<50% follow pattern) | TREAT |
