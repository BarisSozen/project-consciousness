/**
 * English locale strings
 */

import type { LocaleStrings } from './types.js';

export const en: LocaleStrings = {
  // ── Orchestrator ──────────────────────────────────
  orchestratorStarting: '🚀 Orchestration starting...',
  memoryValidated: '✅ Memory integrity validated',
  memorySnapshotTaken: '📸 Memory snapshot taken',
  planCreating: '📋 Creating plan...',
  planReady: (taskCount, stepCount) => `✅ Plan ready: ${taskCount} tasks, ${stepCount} steps`,
  agentRunnerHealth: (ready, detail) => `🏥 Agent runner: ${ready ? '✅' : '❌'} ${detail}`,
  phaseTransition: (phase) => `📌 Phase transition: ${phase}`,
  stepHeader: (current, total, ids) => `\n── Step ${current}/${total}: [${ids}] ──`,
  taskStarting: (id) => `  ⚡ Task ${id} starting...`,
  taskResult: (id, success, duration) => `  ${success ? '✅' : '❌'} Task ${id}: ${success ? 'succeeded' : 'failed'} (${duration}ms)`,
  evalResult: (verdict, consistency, quality, mission) => `  📊 Evaluation: ${verdict} (consistency: ${consistency}, quality: ${quality}, mission: ${mission})`,
  accepted: '  ✅ Accepted.',
  reviseNeeded: '  🔄 Revision needed.',
  escalationNeeded: '  🚨 Escalation required!',
  allTasksComplete: '\n🏁 All tasks completed, entering review phase.',
  sessionComplete: (id) => `✅ Session completed: ${id}`,
  totalSteps: (count) => `📊 Total steps: ${count}`,
  finalPhase: (phase) => `📌 Final phase: ${phase}`,

  // ── Agent ─────────────────────────────────────────
  agentStarting: (agentId, taskId) => `  🤖 Agent [${agentId}] starting for task ${taskId}...`,
  promptReady: (length) => `  📝 Prompt ready (${length} chars)`,
  agentTimeout: (duration) => `  ⏰ Agent timeout! (${duration}ms)`,
  agentComplete: (agentId, duration) => `  Agent [${agentId}] completed (${duration}ms)`,
  agentError: (agentId, error) => `  💥 Agent [${agentId}] error: ${error}`,
  parallelBatch: (batchNum, total, ids) => `  📦 Batch ${batchNum}/${total}: [${ids}]`,
  batchResult: (batchNum, succeeded, total) => `  📊 Batch ${batchNum}: ${succeeded}/${total} succeeded`,

  // ── Evaluator ─────────────────────────────────────
  checksResult: (passed, total) => `Checks: ${passed}/${total} passed`,
  antiScopeViolation: (detail) => `⚠️ Anti-scope violations: ${detail}`,
  protectedFileViolation: (file) => `Agent touched protected file: ${file}`,
  forbiddenDepViolation: (dep) => `Forbidden dependency detected: ${dep}`,
  breakingChangeViolation: (bc) => `Unacceptable breaking change detected: ${bc}`,

  // ── Escalator ─────────────────────────────────────
  escalationTitle: (taskId) => `ESCALATION — Task: ${taskId}`,
  escalationReason: 'Reason',
  escalationContext: 'Context',
  escalationOptions: 'Options',
  escalationOptionContinue: 'Continue — accept this output and proceed',
  escalationOptionSkip: 'Skip — skip this task, move to next',
  escalationOptionStop: 'Stop — pause the project',
  escalationPrompt: '\n  Your choice (1=continue / 2=skip / 3=stop): ',
  userResponse: (action) => `  👤 User response: ${action}`,

  // ── Brief ─────────────────────────────────────────
  briefQuestion: '📋 What do you want to build?',
  briefAnalyzing: '🔍 Analyzing...',
  briefSummaryTitle: 'Plan Summary',
  briefConfirm: 'Proceed? (y/n)',

  // ── Architect ─────────────────────────────────────
  architectTitle: 'ARCHITECT — Architecture Decisions',
  authQuestion: '🔐 Auth strategy?',
  databaseQuestion: '🗄️  Database?',
  apiStyleQuestion: '🌐 API style?',
  frontendQuestion: '🖥️  Frontend?',
  deploymentQuestion: '🚀 Deployment target?',

  // ── Memory ────────────────────────────────────────
  missionHeading: '# MISSION',
  missionWhyWeExist: '## Why We Exist',
  missionWhatWeBuilt: '## What We Build',
  missionSuccessCriteria: '## Success Criteria',

  // ── Agent Personas ────────────────────────────────
  coderPersona: `You are an experienced software engineer.
Your task: Implement the given task, write clean code, pass tests.
RULES:
- Write code 100% aligned with MISSION.md
- Follow ARCHITECTURE.md decisions
- Don't contradict DECISIONS.md
- Only do the defined task, don't expand scope
- Explain every file change`,

  reviewerPersona: `You are a code review expert.
Your task: Audit the code against MISSION, ARCHITECTURE, and DECISIONS.
CHECKLIST:
- Mission drift?
- Architecture violation?
- Decision conflict?
- Scope creep?
- Code quality adequate?
Report each finding with [PASS/WARN/FAIL] label.`,

  testerPersona: `You are a QA engineer.
Your task: Write comprehensive tests for the given code.
RULES:
- Cover edge cases
- Use Vitest framework
- Explain why each test exists
- Report coverage`,

  documenterPersona: `You are a technical writer.
Your task: Document code, decisions, and architecture.
RULES:
- Write human-readable markdown
- Add examples
- Stay consistent with ARCHITECTURE.md`,

  plannerSystemPrompt: `You are a project planning expert.
Your task: Read the given brief and project memory, then create a task plan.

RULES:
1. Each task should be atomic and independent (as much as possible)
2. Dependencies must be explicitly stated
3. Parallelizable tasks should be grouped
4. Each task must have clear acceptance criteria
5. Complexity estimates must be realistic
6. Must be 100% aligned with MISSION.md

OUTPUT FORMAT: JSON (TaskPlan type)`,

  evaluatorSystemPrompt: `You are a quality and consistency auditor.
Your task: Evaluate an agent's output against the project memory.

Scores (0-1): consistencyScore, qualityScore, missionAlignment
Issue categories: mission-drift, architecture-violation, decision-conflict, scope-creep

Verdict: accept (>0.7), revise (0.4-0.7), escalate (<0.4 or critical)
Output: JSON (EvaluationResult)`,

  // ── Context Builder ───────────────────────────────
  memoryContextTitle: 'PROJECT MEMORY — This context overrides everything',
  missionLabel: 'MISSION (NEVER FORGET — This is why the project exists)',
  architectureLabel: 'ARCHITECTURE (Architectural decisions — follow these)',
  decisionsLabel: 'DECISIONS (Past decisions — don\'t contradict these)',
  stateLabel: 'STATE (Current status)',
  taskSection: 'TASK',
  outputFormatSection: 'OUTPUT FORMAT',
  scopeWarning: '⚠️ SCOPE WARNING: Only fulfill the acceptance criteria above. Don\'t add extra features, avoid scope creep.',

  // ── General ───────────────────────────────────────
  apiKeyRequired: (keyName) => `❌ ${keyName} environment variable is required`,
  briefRequired: '❌ Brief required. Usage: npx tsx src/index.ts "brief text"',
  missionIntegrityFailed: 'MISSION.md integrity check failed — essential sections are missing',

  // ── Retry ─────────────────────────────────────────
  retryHeader: (attempt, max) => `⚠️ RETRY ${attempt}/${max} — PREVIOUS ATTEMPT FAILED`,
  retryFeedback: 'Feedback',
  retryIssues: 'Detected issues',
  retryScores: (c, q, m) => `Scores: consistency ${(c * 100).toFixed(0)}%, quality ${(q * 100).toFixed(0)}%, mission ${(m * 100).toFixed(0)}%`,
  retryFixInstruction: 'FIX THESE ISSUES and try again.',
};
