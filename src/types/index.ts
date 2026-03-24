/**
 * Project Consciousness — Type Definitions
 * 
 * Tüm sistemin type kontratları burada tanımlanır.
 */

// ============================================================
// Memory Types
// ============================================================

export interface MemoryFiles {
  mission: string;
  architecture: string;
  decisions: string;
  state: string;
}

export interface MemorySnapshot {
  files: MemoryFiles;
  timestamp: string;
  hash: string; // content hash for change detection
}

export interface Decision {
  id: string;           // D001, D002, ...
  title: string;
  date: string;
  context: string;
  decision: string;
  rationale: string;
  alternatives: string;
  status: 'active' | 'superseded' | 'reverted';
}

export interface StateData {
  phase: Phase;
  iteration: number;
  activeTasks: TaskStatus[];
  completedTasks: TaskStatus[];
  blockedTasks: BlockedTask[];
  lastUpdated: string;
}

export type Phase = 
  | 'initialization'
  | 'planning' 
  | 'executing' 
  | 'reviewing' 
  | 'completed'
  | 'paused';

// ============================================================
// Task Types
// ============================================================

export interface TaskDefinition {
  id: string;           // T001, T002, ...
  title: string;
  description: string;
  type: 'code' | 'review' | 'test' | 'document' | 'decision';
  dependencies: string[];  // task IDs
  agent?: string;         // assigned agent type
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  acceptanceCriteria: string[];
}

export interface TaskStatus {
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  assignedAgent?: string;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

export interface BlockedTask {
  taskId: string;
  reason: string;
  escalationStatus: 'pending' | 'escalated' | 'resolved';
}

export interface TaskPlan {
  tasks: TaskDefinition[];
  executionOrder: string[][]; // groups of parallel task IDs
  estimatedSteps: number;
}

// ============================================================
// Orchestrator Types
// ============================================================

export interface OrchestratorConfig {
  projectRoot: string;
  claudeApiKey: string;
  model: string;
  maxRetries: number;
  escalationThreshold: number; // 0-1, below this → escalate
  maxParallelAgents: number;
  verbose: boolean;
}

export interface EvaluationResult {
  taskId: string;
  consistencyScore: number;    // 0-1: hafıza ile ne kadar tutarlı
  qualityScore: number;        // 0-1: çıktı kalitesi
  missionAlignment: number;    // 0-1: misyona uygunluk
  issues: ConsistencyIssue[];
  verdict: 'accept' | 'revise' | 'escalate';
  feedback?: string;
}

export interface ConsistencyIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'mission-drift' | 'architecture-violation' | 'decision-conflict' | 'scope-creep';
  description: string;
  reference?: string; // which memory file/section
}

export interface EscalationRequest {
  taskId: string;
  reason: string;
  context: string;
  options: string[];
  urgency: 'blocking' | 'important' | 'informational';
  retryCount?: number;
}

export type EscalationAction = 'continue' | 'skip' | 'stop' | 'retry';

export interface EscalationResponse {
  action: EscalationAction;
  feedback?: string;
}

// ============================================================
// Agent Types
// ============================================================

export interface AgentConfig {
  id: string;
  type: 'coder' | 'reviewer' | 'tester' | 'documenter';
  capabilities: string[];
}

export interface AgentTask {
  taskDefinition: TaskDefinition;
  memorySnapshot: MemorySnapshot;
  additionalContext?: string;
}

export interface AgentResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  artifacts: string[];  // file paths created/modified
  duration: number;     // ms
  tokensUsed?: number;
}

// ============================================================
// Orchestration Loop Types
// ============================================================

export interface OrchestrationStep {
  stepNumber: number;
  phase: Phase;
  action: 'plan' | 'execute' | 'evaluate' | 'escalate' | 'update-state' | 'complete';
  taskId?: string;
  result?: EvaluationResult | AgentResult;
  memoryDelta?: Partial<MemoryFiles>;
  timestamp: string;
}

export interface OrchestrationSession {
  sessionId: string;
  startedAt: string;
  brief: string;
  steps: OrchestrationStep[];
  finalState?: StateData;
}

// ============================================================
// Brief Types
// ============================================================

export interface BriefScope {
  whatToBuild: string;
  stack: StackType;
  stackDetails?: string;
  successCriteria: string[];
}

export interface BriefAntiScope {
  protectedFiles: string[];
  lockedDecisions: string[];
  forbiddenDeps: string[];
  breakingChanges: string[];
}

export interface Brief {
  scope: BriefScope;
  antiScope: BriefAntiScope;
  collectedAt: string;
}

/** SmartBrief v2 — tek soru → analiz → ürün soruları → otomatik karar */
export interface SmartBriefResult {
  rawInput: string;
  analysis: BriefAnalysis;
  clarifications: ClarificationAnswer[];
  decisions: ArchitectureDecisions;
  scope: BriefScope;
  antiScope: BriefAntiScope;
  collectedAt: string;
}

export interface BriefAnalysis {
  /** Brief'ten otomatik çıkarılan teknik kararlar */
  autoDecisions: Array<{ key: string; value: string; reason: string }>;
  /** Belirsiz ürün soruları */
  uncertainQuestions: ClarificationQuestion[];
  /** Çıkarılan başarı kriterleri */
  inferredCriteria: string[];
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
  defaultAnswer: string;
  category: 'access' | 'visibility' | 'lifecycle' | 'monetization' | 'scope';
}

export interface ClarificationAnswer {
  questionId: string;
  answer: string;
}

export type StackType = 'typescript-node' | 'react' | 'python' | 'go' | 'other';

// ============================================================
// Evaluation Check Types
// ============================================================

export interface CheckResult {
  name: string;
  command?: string;
  passed: boolean;
  output?: string;
  duration?: number;
}

export interface AntiScopeViolation {
  type: 'protected-file' | 'forbidden-dep' | 'breaking-change';
  detail: string;
  file?: string;
}

export interface RealEvaluationResult extends EvaluationResult {
  checks: CheckResult[];
  antiScopeViolations: AntiScopeViolation[];
  stackDetected: StackType;
  integrationTests?: IntegrationTestResult;
}

// ============================================================
// Architecture Decision Types
// ============================================================

export type AuthStrategy = 'jwt' | 'session' | 'oauth' | 'api-key' | 'none';
export type DatabaseChoice = 'postgresql' | 'mongodb' | 'sqlite' | 'in-memory';
export type ApiStyle = 'rest' | 'graphql' | 'trpc';
export type FrontendChoice = 'react' | 'vue' | 'nextjs' | 'api-only';
export type DeployTarget = 'local' | 'docker' | 'cloud';

export interface ArchitectureDecisions {
  auth: AuthStrategy;
  database: DatabaseChoice;
  apiStyle: ApiStyle;
  frontend: FrontendChoice;
  deployment: DeployTarget;
  extras?: Record<string, string>;
}

// ============================================================
// Milestone Types
// ============================================================

export type MilestoneStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface Milestone {
  id: string;           // M01, M02, ...
  title: string;
  description: string;
  dependsOn: string[];  // milestone IDs
  tasks: TaskDefinition[];
  status: MilestoneStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface MilestonePlan {
  milestones: Milestone[];
  totalTasks: number;
}

// ============================================================
// Recovery Types
// ============================================================

export interface Checkpoint {
  sessionId: string;
  milestoneId: string;
  taskId?: string;
  completedMilestones: string[];
  completedTasks: string[];
  timestamp: string;
}

// ============================================================
// Codebase Reader Types
// ============================================================

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  extension: string;
}

export interface ProjectStructure {
  root: string;
  files: FileInfo[];
  directories: string[];
  totalFiles: number;
  totalSize: number;
}

export interface FileContext {
  path: string;
  firstLines: string;
  exports: string[];
  relevanceScore: number;
}

export interface CodebaseContext {
  files: FileContext[];
  totalTokens: number;
  truncated: boolean;
  summary: string;
}

// ============================================================
// Integration Evaluator Types
// ============================================================

export interface EndpointTest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  expectedStatus?: number;
  expectedBody?: Record<string, unknown>;
  description: string;
}

export interface EndpointTestResult {
  test: EndpointTest;
  passed: boolean;
  actualStatus?: number;
  actualBody?: unknown;
  error?: string;
  duration: number;
}

export interface IntegrationTestResult {
  serverStarted: boolean;
  serverStartTime: number;
  endpointResults: EndpointTestResult[];
  passed: number;
  failed: number;
  total: number;
  summary: string;
}
