/**
 * Project Consciousness — Type Definitions
 */

export type { LLMProviderType } from '../llm/types.js';

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
  /** @deprecated Use llmProvider/llmModel instead. Kept for backward compat. */
  claudeApiKey?: string;
  /** @deprecated Use llmModel instead. */
  model?: string;
  /** LLM provider type: 'anthropic' | 'openai' | 'ollama' | 'custom' */
  llmProvider?: import('./index.js').LLMProviderType;
  /** LLM API key (provider-specific) */
  llmApiKey?: string;
  /** LLM model name */
  llmModel?: string;
  /** LLM base URL (for OpenAI-compatible or Ollama) */
  llmBaseUrl?: string;
  /** Agent CLI binary path (default: 'claude') */
  agentBinary?: string;
  /** Locale: 'en' | 'tr' */
  locale?: import('../i18n/index.js').Locale;
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
  type: 'coder' | 'reviewer' | 'tester' | 'documenter' | 'tracer';
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

// ============================================================
// Tracer Agent Types
// ============================================================

/** Bir dosyadaki import ifadesi */
export interface ImportEdge {
  from: string;         // importing file (relative path)
  to: string;           // imported module (resolved relative path or package name)
  symbols: string[];    // imported symbols: ['Router', 'default', '*']
  isTypeOnly: boolean;  // import type { ... }
  line: number;
}

/** Bir dosyadaki export ifadesi */
export interface ExportNode {
  file: string;         // relative path
  symbol: string;       // exported name
  kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 're-export' | 'default';
  line: number;
}

/** Static analiz: import/export graph */
export interface DependencyEdge {
  source: string;       // importer
  target: string;       // importee
  symbols: string[];
  weight: number;       // kaç kez referans var
  typeOnly: boolean;    // all imports in this edge are type-only
}

/** Kullanılmayan veya kırık bağlantı */
export interface WiringIssue {
  type: 'dead-export' | 'missing-import' | 'circular-dep' | 'type-mismatch' | 'unused-dep' | 'phantom-dep' | 'runtime-gap';
  severity: 'critical' | 'warning' | 'info';
  file: string;
  symbol?: string;
  detail: string;
  suggestion?: string;
}

/** LLM semantic analiz sonucu */
export interface SemanticInsight {
  category: 'injection-missing' | 'config-mismatch' | 'interface-drift' | 'handler-gap' | 'data-flow-break';
  description: string;
  files: string[];
  confidence: number;   // 0-1
}

/** Runtime'da yakalanan fonksiyon çağrısı */
export interface RuntimeCall {
  timestamp: number;
  file: string;
  function: string;
  args?: string;        // serialized, first 200 chars
  returnType?: string;
  duration: number;     // ms
  caller?: string;      // who invoked this
}

/** Runtime'da yakalanan HTTP request/response */
export interface RuntimeHttpEvent {
  timestamp: number;
  method: string;
  path: string;
  status: number;
  requestBody?: string;
  responseBody?: string;
  duration: number;
  handlerChain: string[];  // middleware → route handler → service chain
}

/** Runtime trace — bir request'in uçtan uca yolculuğu */
export interface RequestTrace {
  id: string;
  httpEvent: RuntimeHttpEvent;
  calls: RuntimeCall[];
  dataFlow: DataFlowStep[];
  gaps: WiringIssue[];     // bu trace'de tespit edilen sorunlar
}

/** Data flow adımı — verinin bir katmandan diğerine geçişi */
export interface DataFlowStep {
  order: number;
  layer: 'controller' | 'middleware' | 'service' | 'repository' | 'model' | 'util' | 'external';
  file: string;
  function: string;
  dataIn?: string;     // gelen veri tipi/şekli
  dataOut?: string;    // çıkan veri tipi/şekli
  transform?: string;  // ne dönüşüm yapılıyor
}

/** Tracer agent'ın tam raporu */
export interface TracerReport {
  /** Proje dosya/import grafiği */
  graph: {
    nodes: ExportNode[];
    edges: DependencyEdge[];
    entryPoints: string[];
  };
  /** Static analiz sorunları */
  staticIssues: WiringIssue[];
  /** LLM semantic analiz */
  semanticInsights: SemanticInsight[];
  /** Runtime trace'ler (her test edilen endpoint için) */
  runtimeTraces: RequestTrace[];
  /** Tüm sorunların birleştirilmiş listesi */
  allIssues: WiringIssue[];
  /** Özet istatistikler */
  summary: {
    totalFiles: number;
    totalEdges: number;
    totalIssues: number;
    criticalCount: number;
    warningCount: number;
    coveragePercent: number;  // trace edilen dosyaların yüzdesi
  };
  timestamp: string;
}

// ============================================================
// Project Plan Types (LLM-free planning)
// ============================================================

export interface ProjectPlan {
  phases: ProjectPhase[];
  metadata: {
    stack: StackType;
    brief: string;
    detectedFeatures: string[];
    hasExistingCode: boolean;
    createdAt: string;
  };
}

export interface ProjectPhase {
  id: number;
  name: string;
  description: string;
  tasks: PhaseTask[];
  acceptanceCriteria: string[];
  dependsOn: number[];
  estimatedFiles: string[];
}

export interface PhaseTask {
  id: string;           // "P1.T1"
  title: string;
  type: 'create' | 'modify' | 'config' | 'test' | 'document';
  targetFiles: string[];
}
