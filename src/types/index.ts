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
