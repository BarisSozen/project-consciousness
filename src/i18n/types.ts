/**
 * i18n — Internationalization
 *
 * Tüm kullanıcıya görünen string'ler burada tanımlanır.
 * Dil seçimi: LLM_LOCALE env variable veya config ile.
 * Default: 'en'
 */

export type Locale = 'en' | 'tr';

export interface LocaleStrings {
  // ── Orchestrator ──────────────────────────────────
  orchestratorStarting: string;
  memoryValidated: string;
  memorySnapshotTaken: string;
  planCreating: string;
  planReady: (taskCount: number, stepCount: number) => string;
  agentRunnerHealth: (ready: boolean, detail: string) => string;
  phaseTransition: (phase: string) => string;
  stepHeader: (current: number, total: number, ids: string) => string;
  taskStarting: (id: string) => string;
  taskResult: (id: string, success: boolean, duration: number) => string;
  evalResult: (verdict: string, consistency: number, quality: number, mission: number) => string;
  accepted: string;
  reviseNeeded: string;
  escalationNeeded: string;
  allTasksComplete: string;
  sessionComplete: (id: string) => string;
  totalSteps: (count: number) => string;
  finalPhase: (phase: string) => string;

  // ── Agent ─────────────────────────────────────────
  agentStarting: (agentId: string, taskId: string) => string;
  promptReady: (length: number) => string;
  agentTimeout: (duration: number) => string;
  agentComplete: (agentId: string, duration: number) => string;
  agentError: (agentId: string, error: string) => string;
  parallelBatch: (batchNum: number, total: number, ids: string) => string;
  batchResult: (batchNum: number, succeeded: number, total: number) => string;

  // ── Evaluator ─────────────────────────────────────
  checksResult: (passed: number, total: number) => string;
  antiScopeViolation: (detail: string) => string;
  protectedFileViolation: (file: string) => string;
  forbiddenDepViolation: (dep: string) => string;
  breakingChangeViolation: (bc: string) => string;

  // ── Escalator ─────────────────────────────────────
  escalationTitle: (taskId: string) => string;
  escalationReason: string;
  escalationContext: string;
  escalationOptions: string;
  escalationOptionContinue: string;
  escalationOptionSkip: string;
  escalationOptionStop: string;
  escalationPrompt: string;
  userResponse: (action: string) => string;

  // ── Brief ─────────────────────────────────────────
  briefQuestion: string;
  briefAnalyzing: string;
  briefSummaryTitle: string;
  briefConfirm: string;

  // ── Architect ─────────────────────────────────────
  architectTitle: string;
  authQuestion: string;
  databaseQuestion: string;
  apiStyleQuestion: string;
  frontendQuestion: string;
  deploymentQuestion: string;

  // ── Memory ────────────────────────────────────────
  missionHeading: string;
  missionWhyWeExist: string;
  missionWhatWeBuilt: string;
  missionSuccessCriteria: string;

  // ── Agent Personas (system prompts) ───────────────
  coderPersona: string;
  reviewerPersona: string;
  testerPersona: string;
  documenterPersona: string;
  plannerSystemPrompt: string;
  evaluatorSystemPrompt: string;

  // ── Context Builder ───────────────────────────────
  memoryContextTitle: string;
  missionLabel: string;
  architectureLabel: string;
  decisionsLabel: string;
  stateLabel: string;
  taskSection: string;
  outputFormatSection: string;
  scopeWarning: string;

  // ── General ───────────────────────────────────────
  apiKeyRequired: (keyName: string) => string;
  briefRequired: string;
  missionIntegrityFailed: string;

  // ── Retry ─────────────────────────────────────────
  retryHeader: (attempt: number, max: number) => string;
  retryFeedback: string;
  retryIssues: string;
  retryScores: (consistency: number, quality: number, mission: number) => string;
  retryFixInstruction: string;
}
