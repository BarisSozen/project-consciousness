/**
 * ArchitectAgent + MilestoneManager + Recovery + Integration Tests
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ArchitectAgent } from '../src/agent/architect.js';
import { MilestoneManager } from '../src/orchestrator/milestone-manager.js';
import { DependencyGraph } from '../src/orchestrator/dependency-graph.js';
import { RecoveryManager } from '../src/orchestrator/recovery.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ArchitectureDecisions } from '../src/types/index.js';

const TEST_DIR = join(tmpdir(), `pc-arch-${Date.now()}`);

describe('ArchitectAgent', () => {
  const agent = new ArchitectAgent();

  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should create decisions with defaults', () => {
    const d = agent.runWithDefaults({
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'docker',
    });
    expect(d.auth).toBe('jwt');
    expect(d.database).toBe('postgresql');
  });

  it('should collect answers with mocked askFn', async () => {
    // Her soru için '1' döndür → her kategorinin ilk seçeneği
    agent.setAskFn(async () => '1');
    const d = await agent.runInteractive();
    expect(d.auth).toBe('jwt');            // option 1 of auth
    expect(d.database).toBe('postgresql'); // option 1 of db
    expect(d.apiStyle).toBe('rest');       // option 1 of api
    expect(d.frontend).toBe('react');      // option 1 of frontend
    expect(d.deployment).toBe('local');    // option 1 of deployment
  });

  it('should write decisions to ARCHITECTURE.md', async () => {
    const archPath = join(TEST_DIR, 'ARCHITECTURE.md');
    await writeFile(archPath, '# ARCHITECTURE\n\n## Stack\nTypeScript\n');

    const d: ArchitectureDecisions = {
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'react', deployment: 'docker',
    };
    await agent.writeToArchitecture(d, archPath);

    const content = await readFile(archPath, 'utf-8');
    expect(content).toContain('## Kararlar');
    expect(content).toContain('**Auth**: jwt');
    expect(content).toContain('**Database**: postgresql');
    expect(content).toContain('**Frontend**: react');
    // Original content preserved
    expect(content).toContain('# ARCHITECTURE');
    expect(content).toContain('## Stack');
  });

  it('should parse decisions from ARCHITECTURE.md', () => {
    const content = `# ARCHITECTURE
## Kararlar

**Auth**: jwt
**Database**: postgresql
**API**: rest
**Frontend**: api-only
**Deployment**: docker
`;
    const d = ArchitectAgent.parseDecisions(content);
    expect(d).not.toBeNull();
    expect(d!.auth).toBe('jwt');
    expect(d!.database).toBe('postgresql');
    expect(d!.apiStyle).toBe('rest');
  });
});

describe('MilestoneManager', () => {
  const mm = new MilestoneManager();

  it('should create milestones for full stack project', () => {
    const plan = mm.createMilestones('Blog API', {
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'react', deployment: 'docker',
    });

    expect(plan.milestones.length).toBeGreaterThanOrEqual(4); // foundation, auth, api, frontend, integration
    expect(plan.milestones[0]!.id).toBe('M01');
    expect(plan.milestones[0]!.title).toBe('Foundation');
    expect(plan.totalTasks).toBeGreaterThan(5);
  });

  it('should create milestones for api-only project', () => {
    const plan = mm.createMilestones('Simple API', {
      auth: 'none', database: 'in-memory', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'local',
    });

    // No auth, no frontend → foundation + api + integration = 3
    expect(plan.milestones.length).toBe(3);
    expect(plan.milestones.some(m => m.title === 'Auth')).toBe(false);
    expect(plan.milestones.some(m => m.title === 'Frontend')).toBe(false);
  });

  it('should set correct dependencies', () => {
    const plan = mm.createMilestones('Blog', {
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'local',
    });

    const auth = plan.milestones.find(m => m.title === 'Auth');
    const api = plan.milestones.find(m => m.title === 'API');
    expect(auth!.dependsOn).toContain('M01');
    expect(api!.dependsOn).toContain('M02'); // depends on auth
  });

  it('should find next milestone', () => {
    const plan = mm.createMilestones('Test', {
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'local',
    });

    // Initially M01 is next (no deps)
    const first = mm.getNextMilestone(plan.milestones);
    expect(first!.id).toBe('M01');

    // After M01 done, M02 is next
    mm.updateStatus(plan.milestones[0]!, 'done');
    const second = mm.getNextMilestone(plan.milestones);
    expect(second!.title).toBe('Auth');
  });

  it('should render milestone state', () => {
    const plan = mm.createMilestones('Test', {
      auth: 'none', database: 'in-memory', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'local',
    });
    mm.updateStatus(plan.milestones[0]!, 'done');

    const rendered = mm.renderMilestoneState(plan.milestones);
    expect(rendered).toContain('[x] M01');
    expect(rendered).toContain('[ ] M02');
  });
});

describe('RecoveryManager', () => {
  let recovery: RecoveryManager;

  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_DIR, { recursive: true });
    recovery = new RecoveryManager(TEST_DIR);
  });

  it('should save and load checkpoint', async () => {
    const cp = {
      sessionId: 'test-session',
      milestoneId: 'M02',
      completedMilestones: ['M01'],
      completedTasks: ['T001', 'T002'],
      timestamp: new Date().toISOString(),
    };
    await recovery.saveCheckpoint(cp);
    const loaded = await recovery.loadCheckpoint();
    expect(loaded).toEqual(cp);
  });

  it('should detect resumable checkpoint', async () => {
    expect(await recovery.canResume()).toBe(false);
    await recovery.saveCheckpoint({
      sessionId: 's1', milestoneId: 'M01',
      completedMilestones: [], completedTasks: [],
      timestamp: new Date().toISOString(),
    });
    expect(await recovery.canResume()).toBe(true);
  });

  it('should clear checkpoint', async () => {
    await recovery.saveCheckpoint({
      sessionId: 's1', milestoneId: 'M01',
      completedMilestones: [], completedTasks: [],
      timestamp: new Date().toISOString(),
    });
    await recovery.clearCheckpoint();
    expect(await recovery.canResume()).toBe(false);
  });

  it('should prompt resume with mocked ask', async () => {
    recovery.setAskFn(async () => 'e');
    const result = await recovery.promptResume({
      sessionId: 's1', milestoneId: 'M02',
      completedMilestones: ['M01'], completedTasks: ['T001'],
      timestamp: new Date().toISOString(),
    });
    expect(result).toBe(true);
  });

  it('should get resume point', () => {
    const cp = {
      sessionId: 's1', milestoneId: 'M02',
      completedMilestones: ['M01'], completedTasks: ['T001', 'T002'],
      timestamp: new Date().toISOString(),
    };
    const point = recovery.getResumePoint(cp);
    expect(point.milestoneId).toBe('M02');
    expect(point.completedTasks.has('T001')).toBe(true);
  });
});

describe('Integration: Blog API Pipeline', () => {
  it('should create full pipeline: architect → milestones → dependency graph', () => {
    // 1. ArchitectAgent defaults
    const arch = new ArchitectAgent().runWithDefaults({
      auth: 'jwt', database: 'postgresql', apiStyle: 'rest',
      frontend: 'api-only', deployment: 'local',
    });

    // 2. MilestoneManager
    const mm = new MilestoneManager();
    const plan = mm.createMilestones('Blog API: auth + post CRUD', arch);

    expect(plan.milestones.length).toBeGreaterThanOrEqual(4);
    expect(plan.milestones[0]!.title).toBe('Foundation');

    // 3. DependencyGraph for each milestone
    for (const milestone of plan.milestones) {
      const graph = new DependencyGraph();
      for (const task of milestone.tasks) {
        graph.addTask(task);
      }
      expect(graph.hasCycle()).toBe(false);
      const order = graph.getExecutionOrder();
      expect(order.length).toBeGreaterThan(0);
    }

    // 4. Milestone dependency chain
    const m01 = plan.milestones.find(m => m.id === 'M01')!;
    const m02 = plan.milestones.find(m => m.id === 'M02')!;
    const m03 = plan.milestones.find(m => m.id === 'M03')!;

    expect(m01.dependsOn).toEqual([]);
    expect(m02.dependsOn).toContain('M01');
    expect(m03.dependsOn).toContain('M02');

    // 5. Milestone execution simulation
    expect(mm.getNextMilestone(plan.milestones)!.id).toBe('M01');
    mm.updateStatus(m01, 'done');
    expect(mm.getNextMilestone(plan.milestones)!.id).toBe('M02');
    mm.updateStatus(m02, 'done');
    expect(mm.getNextMilestone(plan.milestones)!.id).toBe('M03');
  });

  it('should handle crash recovery in pipeline', async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_DIR, { recursive: true });

    // Simulate: M01 done, M02 running, crash
    const recovery = new RecoveryManager(TEST_DIR);
    await recovery.saveCheckpoint({
      sessionId: 'blog-session',
      milestoneId: 'M02',
      completedMilestones: ['M01'],
      completedTasks: ['T001', 'T002'],
      timestamp: new Date().toISOString(),
    });

    // Resume
    expect(await recovery.canResume()).toBe(true);
    const cp = await recovery.loadCheckpoint();
    const point = recovery.getResumePoint(cp!);
    expect(point.milestoneId).toBe('M02');
    expect(point.completedTasks.has('T001')).toBe(true);

    // After completion, clear
    await recovery.clearCheckpoint();
    expect(await recovery.canResume()).toBe(false);
  });
});
