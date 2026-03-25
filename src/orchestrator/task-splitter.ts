/**
 * Task Splitter — Adaptive Task Decomposition + Context Handoff
 *
 * Problem: Agent has ~8K token context. A task that produces 5+ files
 * overwhelms context → half the code is wrong.
 *
 * Solution: Analyze each task before execution:
 * 1. Estimate how many files it will produce
 * 2. If > MAX_FILES_PER_TASK, split into sub-tasks
 * 3. Each sub-task gets a handoff note from ContextAccumulator
 *    so the next agent knows what was already built
 *
 * Splitting strategy:
 * - Layer-based: types/models first → services → routes → tests
 * - Each sub-task targets ≤ 3 files
 * - Handoff note includes: file paths, exports, key types, function signatures
 */

import type { TaskDefinition } from '../types/index.js';

// ═══════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════

/** Max files per agent task before splitting */
const MAX_FILES_PER_TASK = 3;

/** Layer ordering — types first, tests last */
const LAYER_ORDER: Array<{ layer: string; keywords: string[]; priority: number }> = [
  { layer: 'types',      keywords: ['type', 'interface', 'model', 'schema', 'entity'],           priority: 1 },
  { layer: 'config',     keywords: ['config', 'env', 'setup', 'database', 'connection'],         priority: 2 },
  { layer: 'service',    keywords: ['service', 'logic', 'handler', 'processor', 'manager'],      priority: 3 },
  { layer: 'route',      keywords: ['route', 'controller', 'endpoint', 'api', 'resolver'],       priority: 4 },
  { layer: 'middleware',  keywords: ['middleware', 'auth', 'guard', 'interceptor', 'validator'],  priority: 5 },
  { layer: 'test',       keywords: ['test', 'spec', 'e2e', 'integration'],                      priority: 6 },
];

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface SplitResult {
  /** Original task (if no split needed) or null */
  original: TaskDefinition | null;
  /** Sub-tasks (if split) or empty */
  subTasks: TaskDefinition[];
  /** Whether the task was split */
  wasSplit: boolean;
  /** Reason for split (or "no split needed") */
  reason: string;
}

// ═══════════════════════════════════════════════════════════
// Splitter
// ═══════════════════════════════════════════════════════════

export class TaskSplitter {
  /**
   * Analyze a task and optionally split it into sub-tasks.
   *
   * @param task The original task definition
   * @param handoffContext Markdown from ContextAccumulator (what's been built so far)
   * @returns SplitResult with either original or sub-tasks
   */
  split(task: TaskDefinition, handoffContext?: string): SplitResult {
    // Never split document, config, or test-only tasks
    if (task.type === 'document' || task.type === 'review') {
      return { original: this.injectHandoff(task, handoffContext ?? ''), subTasks: [], wasSplit: false, reason: 'Document/review tasks are not split' };
    }

    // Never split tasks with explicit single-file targets
    const desc = `${task.title} ${task.description}`.toLowerCase();
    const singleFileSignals = ['readme', '.env', 'config', 'dockerfile', 'docker-compose', 'changelog', 'license'];
    if (singleFileSignals.some(s => desc.includes(s))) {
      return { original: this.injectHandoff(task, handoffContext ?? ''), subTasks: [], wasSplit: false, reason: 'Single-file task, no split needed' };
    }

    const estimatedFiles = this.estimateFileCount(task);

    if (estimatedFiles <= MAX_FILES_PER_TASK) {
      // No split needed — but inject handoff context if available
      if (handoffContext) {
        return {
          original: this.injectHandoff(task, handoffContext),
          subTasks: [],
          wasSplit: false,
          reason: `${estimatedFiles} estimated files ≤ ${MAX_FILES_PER_TASK} limit`,
        };
      }
      return { original: task, subTasks: [], wasSplit: false, reason: 'Small task, no split needed' };
    }

    // Split by layer
    const subTasks = this.splitByLayer(task, handoffContext);

    return {
      original: null,
      subTasks,
      wasSplit: true,
      reason: `${estimatedFiles} estimated files > ${MAX_FILES_PER_TASK} limit → split into ${subTasks.length} sub-tasks`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // File Estimation
  // ═══════════════════════════════════════════════════════════

  private estimateFileCount(task: TaskDefinition): number {
    const desc = `${task.title}`.toLowerCase(); // Use TITLE only, not full description (which includes brief text)

    let count = 1; // at least 1 file

    // Entity-based estimation — only from task title, not injected brief
    const entities = this.extractEntities(desc);
    if (entities.length > 0) {
      // Each entity typically produces: model + service + route = 3 files
      count = entities.length * 3;

      // Auth adds middleware + tests
      if (desc.includes('auth') || desc.includes('login') || desc.includes('jwt')) {
        count += 2;
      }
    }

    // Keyword-based estimation
    const fileKeywords = ['route', 'service', 'model', 'schema', 'middleware', 'controller', 'test', 'config', 'migration'];
    for (const kw of fileKeywords) {
      if (desc.includes(kw)) count = Math.max(count, 2);
    }

    // "CRUD" implies model + service + route + test = 4
    if (desc.includes('crud')) {
      count = Math.max(count, 4 * Math.max(entities.length, 1));
    }

    // Acceptance criteria often hint at scope
    count = Math.max(count, Math.ceil(task.acceptanceCriteria.length / 2));

    return count;
  }

  private extractEntities(text: string): string[] {
    const entityPatterns = [
      /\b(user|todo|task|post|comment|product|order|category|tag|project|team|message|notification|payment|invoice)\b/gi,
    ];

    const found = new Set<string>();
    for (const pattern of entityPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          found.add(m.toLowerCase());
        }
      }
    }

    return [...found];
  }

  // ═══════════════════════════════════════════════════════════
  // Layer-Based Splitting
  // ═══════════════════════════════════════════════════════════

  private splitByLayer(task: TaskDefinition, handoffContext?: string): TaskDefinition[] {
    const desc = `${task.title} ${task.description}`.toLowerCase();
    const entities = this.extractEntities(desc);
    const subTasks: TaskDefinition[] = [];

    // Determine which layers this task involves
    const involvedLayers = LAYER_ORDER.filter(layer =>
      layer.keywords.some(kw => desc.includes(kw)) || layer.layer === 'types' || layer.layer === 'test'
    );

    // Group into sub-tasks of ≤ MAX_FILES_PER_TASK
    let currentBatch: typeof LAYER_ORDER = [];
    let currentFileEstimate = 0;
    let subTaskIdx = 0;

    for (const layer of involvedLayers) {
      const filesForLayer = layer.layer === 'test'
        ? Math.max(entities.length, 1)
        : layer.layer === 'types'
          ? 1
          : Math.max(entities.length, 1);

      if (currentFileEstimate + filesForLayer > MAX_FILES_PER_TASK && currentBatch.length > 0) {
        // Flush current batch as sub-task
        subTasks.push(this.createSubTask(task, currentBatch, subTaskIdx, entities, handoffContext, subTasks));
        subTaskIdx++;
        currentBatch = [];
        currentFileEstimate = 0;
      }

      currentBatch.push(layer);
      currentFileEstimate += filesForLayer;
    }

    // Flush remaining
    if (currentBatch.length > 0) {
      subTasks.push(this.createSubTask(task, currentBatch, subTaskIdx, entities, handoffContext, subTasks));
    }

    // If only 1 sub-task, just return original with handoff
    if (subTasks.length <= 1) {
      return [this.injectHandoff(task, handoffContext ?? '')];
    }

    // Set dependencies: each sub-task depends on previous
    for (let i = 1; i < subTasks.length; i++) {
      subTasks[i]!.dependencies = [subTasks[i - 1]!.id];
    }

    return subTasks;
  }

  private createSubTask(
    parent: TaskDefinition,
    layers: typeof LAYER_ORDER,
    idx: number,
    entities: string[],
    handoffContext?: string,
    previousSubTasks?: TaskDefinition[],
  ): TaskDefinition {
    const layerNames = layers.map(l => l.layer).join(' + ');
    const entityList = entities.length > 0 ? ` for ${entities.join(', ')}` : '';

    // Build handoff section from previous sub-tasks
    let handoff = '';
    if (handoffContext) {
      handoff = `\n\n## Already Built (from previous tasks)\n${handoffContext}`;
    }
    if (previousSubTasks && previousSubTasks.length > 0) {
      const prevSummary = previousSubTasks
        .map(t => `- ${t.id}: ${t.title}`)
        .join('\n');
      handoff += `\n\n## Previous Sub-Tasks in This Batch\n${prevSummary}\nUse the same naming conventions, import paths, and types as the previous sub-tasks.`;
    }

    // Build guidance for this layer group
    const guidance = layers.map(l => {
      switch (l.layer) {
        case 'types':
          return `Create TypeScript interfaces/types${entityList}. Export all types. Use strict typing.`;
        case 'config':
          return `Set up configuration, database connection, environment validation.`;
        case 'service':
          return `Implement business logic${entityList}. Import types from the types file. Each function should be pure and testable.`;
        case 'route':
          return `Create API routes/controllers${entityList}. Import services. Add input validation.`;
        case 'middleware':
          return `Create middleware (auth, validation, error handling). Export as named exports.`;
        case 'test':
          return `Write tests for all functions created in previous sub-tasks. Use the project's test framework and patterns.`;
        default:
          return `Implement ${l.layer} layer${entityList}.`;
      }
    }).join('\n');

    return {
      id: `${parent.id}.${idx + 1}`,
      title: `${parent.title} — ${layerNames}${entityList}`,
      description: `${parent.description}\n\n## Focus: ${layerNames}\n${guidance}${handoff}`,
      type: parent.type,
      dependencies: [],
      agent: parent.agent,
      priority: parent.priority,
      estimatedComplexity: layers.length <= 2 ? 'simple' : 'moderate',
      acceptanceCriteria: parent.acceptanceCriteria.filter(c => {
        const cl = c.toLowerCase();
        return layers.some(l => l.keywords.some(kw => cl.includes(kw))) || true;
      }).slice(0, 3), // limit per sub-task
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Handoff Injection
  // ═══════════════════════════════════════════════════════════

  private injectHandoff(task: TaskDefinition, handoffContext: string): TaskDefinition {
    if (!handoffContext) return task;

    return {
      ...task,
      description: `${task.description}\n\n## Already Built (context from previous tasks)\n${handoffContext}`,
    };
  }
}
