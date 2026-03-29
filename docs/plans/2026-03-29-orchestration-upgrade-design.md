# Orchestration Upgrade Design — 4-Layer Enhancement

**Date**: 2026-03-29
**Status**: Approved
**Scope**: Resilience, Context Intelligence, Agent Learning, Orchestration Intelligence

---

## Layer 1: Resilience & Recovery

### 1.1 Atomic File Writes (`memory-layer.ts`)
- Write to `.tmp` then `rename()` for STATE.md and DECISIONS.md
- Pre-write backup to `.pc-backup/<filename>.bak`
- On corrupt detection (parse failure), restore from backup

### 1.2 Rich Checkpoint (`types/index.ts`, `recovery.ts`)
Extend `Checkpoint` interface:
```typescript
interface Checkpoint {
  sessionId: string;
  milestoneId: string;
  completedMilestones: string[];
  completedTasks: string[];
  timestamp: string;
  // NEW
  currentTaskId: string | null;
  completedSubTasks: string[];
  pendingArtifacts: string[];
  memoryHash: string;
  executionGroupIndex: number;
  retryContext?: {
    taskId: string;
    attempt: number;
    lastError: string;
  };
}
```

### 1.3 Orphan Recovery (new `orphan-detector.ts`)
- On resume: scan git unstaged changes
- Match against checkpoint `pendingArtifacts`
- Prompt user for inclusion/exclusion

---

## Layer 2: Context Intelligence

### 2.1 Token-Aware Budget (`context-builder.ts`)
```typescript
interface TokenBudget {
  total: number;        // agent max context
  persona: number;      // ~500 fixed
  conventions: number;  // ~300 fixed
  memory: number;       // 40% of remaining
  codebase: number;     // 35% of remaining
  task: number;         // 25% of remaining
}
```
Trimming priority: decisions > completed tasks > codebase > (never trim task)

### 2.2 Agent-Specific Context Profiles (`context-builder.ts`)
```typescript
const CONTEXT_PROFILES: Record<AgentType, ContextProfile> = {
  coder:      { memoryPriority: ['architecture','state','decisions','mission'], codebaseFocus: 'implementation-files' },
  tester:     { memoryPriority: ['state','mission','architecture','decisions'], codebaseFocus: 'test-files-and-interfaces' },
  reviewer:   { memoryPriority: ['mission','decisions','architecture','state'], codebaseFocus: 'changed-files' },
  documenter: { memoryPriority: ['architecture','mission','state','decisions'], codebaseFocus: 'public-api-files' },
};
```

### 2.3 Semantic Context Ranking (`context-accumulator.ts`)
- Keyword extraction from current task description
- Relevance scoring against accumulated exports
- Top-N filtering before injecting into STATE.md

---

## Layer 3: Agent Learning Loop

### 3.1 Retry with Feedback Injection (`orchestrator.ts`)
```typescript
interface RetryContext {
  attempt: number;
  previousOutput: string;
  evaluationFeedback: string;
  specificFixes: string[];
  failedChecks: string[];
}
```
Injected into agent prompt as `PREVIOUS ATTEMPT (FAILED)` section.

### 3.2 Error Pattern Memory (new `error-pattern-tracker.ts`)
```typescript
interface ErrorPattern {
  id: string;               // EP001
  pattern: string;          // "hardcoded-connection-string"
  category: 'type-error' | 'anti-scope' | 'convention' | 'logic';
  occurrences: number;
  firstSeen: string;
  fix: string;
  affectedTasks: string[];
}
```
Stored in `.pc-error-patterns.json`. Injected as `KNOWN PITFALLS` in all agent prompts.

### 3.3 Cross-Session Learning (`LESSONS.md`)
- New 5th memory file, append-only
- Populated at session end from patterns with 2+ occurrences
- Read by ContextBuilder, injected as conventions
- MemoryLayer updated: `readLessons()`, `appendLesson()`

---

## Layer 4: Orchestration Intelligence

### 4.1 Dynamic Task Scheduler (new `dynamic-scheduler.ts`)
```typescript
class DynamicScheduler {
  getReady(tasks): TaskDefinition[]     // deps resolved, not running
  markDone(taskId): TaskDefinition[]    // unlock dependents
  markFailed(taskId): string[]          // skip transitive dependents
}
```
Replaces static `for groupIdx` loop with event-driven ready-queue.

### 4.2 Critical Path Analysis (`dependency-graph.ts`)
```typescript
interface CriticalPathInfo {
  criticalPath: string[];
  estimatedDuration: number;
  parallelizableCount: number;
  bottleneck: string | null;
}
```
Complexity-to-duration mapping: trivial=30s, simple=60s, moderate=120s, complex=240s.
Bottleneck tasks auto-split via TaskSplitter.

### 4.3 File Lock Manager (new `file-lock.ts`)
```typescript
class FileLockManager {
  acquire(taskId, filePaths): LockResult
  release(taskId): void
}
```
Integrated with DynamicScheduler: conflict = defer task to next cycle.

---

## Implementation Order

| Phase | Files | Depends On |
|-------|-------|-----------|
| 1. Types | `types/index.ts` | — |
| 2. Atomic Writes | `memory-layer.ts` | Types |
| 3. Rich Checkpoint | `recovery.ts` | Types |
| 4. Orphan Detector | new `orphan-detector.ts` | Rich Checkpoint |
| 5. Token Budget | `context-builder.ts` | — |
| 6. Agent Profiles | `context-builder.ts` | Token Budget |
| 7. Semantic Ranking | `context-accumulator.ts` | — |
| 8. Retry Feedback | `orchestrator.ts` | Types |
| 9. Error Patterns | new `error-pattern-tracker.ts` | — |
| 10. LESSONS.md | `memory-layer.ts` | Error Patterns |
| 11. Dynamic Scheduler | new `dynamic-scheduler.ts` | — |
| 12. Critical Path | `dependency-graph.ts` | Dynamic Scheduler |
| 13. File Lock | new `file-lock.ts` | — |
| 14. Orchestrator Integration | `orchestrator.ts` | All above |

## New Files
- `src/orchestrator/orphan-detector.ts`
- `src/orchestrator/error-pattern-tracker.ts`
- `src/orchestrator/dynamic-scheduler.ts`
- `src/orchestrator/file-lock.ts`

## Modified Files
- `src/types/index.ts`
- `src/memory/memory-layer.ts`
- `src/orchestrator/recovery.ts`
- `src/agent/context-builder.ts`
- `src/orchestrator/context-accumulator.ts`
- `src/orchestrator/evaluator.ts`
- `src/orchestrator/orchestrator.ts`
- `src/orchestrator/dependency-graph.ts`
