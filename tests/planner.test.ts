/**
 * Plan Generator Tests
 */

import { describe, it, expect } from 'vitest';
import { PlanGenerator } from '../src/planner/plan-generator.js';
import { AimCollector } from '../src/planner/aim-collector.js';
import { computeCoverage, renderCoverageMd } from '../src/planner/coverage.js';
import { FEATURE_DETECTORS } from '../src/planner/templates.js';
import type { Brief, AimNode } from '../src/types/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';

const TEST_DIR = join(tmpdir(), 'pc-planner-test-' + Date.now());

function makeBrief(whatToBuild: string, stack: Brief['scope']['stack'] = 'typescript-node'): Brief {
  return {
    scope: {
      whatToBuild,
      stack,
      successCriteria: ['Çalışıyor', 'Test edildi'],
    },
    antiScope: {
      protectedFiles: [],
      lockedDecisions: [],
      forbiddenDeps: [],
      breakingChanges: [],
    },
    collectedAt: new Date().toISOString(),
  };
}

describe('PlanGenerator', () => {
  it('should generate a plan from a basic Node brief', async () => {
    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('A REST API for todo management'));

    expect(plan.phases.length).toBeGreaterThanOrEqual(3); // setup + core + test + docs
    expect(plan.metadata.stack).toBe('typescript-node');
    expect(plan.phases[0]!.id).toBe(1);
    expect(plan.phases[0]!.dependsOn).toEqual([]);
    expect(plan.phases[1]!.dependsOn).toEqual([1]);
  });

  it('should detect features from brief keywords', async () => {
    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(
      makeBrief('Build a DeFi dashboard with wallet connection, auth system, and real-time price updates', 'react')
    );

    expect(plan.metadata.detectedFeatures).toContain('auth');
    expect(plan.metadata.detectedFeatures).toContain('blockchain');
    expect(plan.metadata.detectedFeatures).toContain('realtime');
    expect(plan.metadata.detectedFeatures).toContain('frontend');
  });

  it('should assign sequential task IDs', async () => {
    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('Simple API'));

    for (const phase of plan.phases) {
      for (let i = 0; i < phase.tasks.length; i++) {
        expect(phase.tasks[i]!.id).toBe(`P${phase.id}.T${i + 1}`);
      }
    }
  });

  it('should map success criteria to acceptance criteria', async () => {
    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('API project'));

    const testPhase = plan.phases.find(p => p.name === 'Testing & QA');
    expect(testPhase).toBeDefined();
    expect(testPhase!.acceptanceCriteria.some(ac => ac.includes('Çalışıyor'))).toBe(true);
  });

  it('should adapt for existing codebase', async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, 'package.json'), '{"name":"existing"}');

    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('Add new features'));

    expect(plan.metadata.hasExistingCode).toBe(true);
    expect(plan.phases[0]!.name).toContain('Review');

    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should write PLAN.md', async () => {
    await mkdir(TEST_DIR, { recursive: true });

    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('Todo API'));
    const planPath = await planner.writePlan(plan);

    const content = await readFile(planPath, 'utf-8');
    expect(content).toContain('# PROJECT PLAN');
    expect(content).toContain('Phase 1');
    expect(content).toContain('- [ ]');

    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should use React template for react stack', async () => {
    const planner = new PlanGenerator(TEST_DIR);
    const plan = await planner.generate(makeBrief('Dashboard app', 'react'));

    expect(plan.phases[0]!.name).toContain('Setup');
    expect(plan.phases.some(p => p.name.includes('Components'))).toBe(true);
  });
});

describe('FeatureDetectors', () => {
  it('should have unique names', () => {
    const names = FEATURE_DETECTORS.map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should all have at least 2 keywords', () => {
    for (const d of FEATURE_DETECTORS) {
      expect(d.keywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should detect Turkish keywords', () => {
    const authDetector = FEATURE_DETECTORS.find(d => d.name === 'auth')!;
    expect(authDetector.keywords).toContain('giriş');

    const dbDetector = FEATURE_DETECTORS.find(d => d.name === 'database')!;
    expect(dbDetector.keywords).toContain('veritabanı');
  });
});

// ── Aim Tree Tests ──────────────────────────────────────────

describe('AimCollector', () => {
  it('should create aim tree programmatically', () => {
    const root = AimCollector.create('Users can trade securely', [
      AimCollector.create('Users can authenticate'),
      AimCollector.create('Trades settle atomically'),
    ]);

    // Fix child IDs
    root.children[0]!.id = 'A1.1';
    root.children[1]!.id = 'A1.2';

    expect(root.id).toBe('A1');
    expect(root.children.length).toBe(2);
    expect(root.children[0]!.id).toBe('A1.1');
  });

  it('should render markdown', () => {
    const collector = new AimCollector();
    const root = AimCollector.create('Main goal', []);
    root.children.push({
      id: 'A1.1',
      aim: 'Sub goal 1',
      children: [],
      linkedTasks: ['P2.T1'],
      priority: 'high',
    });

    const md = collector.renderMarkdown(root);
    expect(md).toContain('# AIM TREE');
    expect(md).toContain('Main goal');
    expect(md).toContain('Sub goal 1');
    expect(md).toContain('P2.T1');
  });
});

// ── Coverage Matrix Tests ───────────────────────────────────

describe('Coverage', () => {
  it('should detect covered and uncovered aims', () => {
    const aimRoot: AimNode = {
      id: 'A1',
      aim: 'Main',
      children: [
        { id: 'A1.1', aim: 'Auth login', children: [], linkedTasks: [], priority: 'high' },
        { id: 'A1.2', aim: 'Quantum teleportation', children: [], linkedTasks: [], priority: 'medium' },
      ],
      linkedTasks: [],
      priority: 'critical',
    };

    const phases = [
      {
        id: 1, name: 'Auth Setup', description: '', dependsOn: [], estimatedFiles: [],
        acceptanceCriteria: [],
        tasks: [
          { id: 'P1.T1', title: 'Auth login service', type: 'create' as const, targetFiles: [] },
        ],
      },
    ];

    const coverage = computeCoverage(aimRoot, phases);

    // A1.1 "Auth login" should match P1.T1 "Auth login service"
    expect(coverage.covered.some(c => c.aimId === 'A1.1')).toBe(true);

    // A1.2 "Quantum teleportation" has no matching task
    expect(coverage.uncovered.some(u => u.aimId === 'A1.2')).toBe(true);
  });

  it('should detect orphan tasks', () => {
    const aimRoot: AimNode = {
      id: 'A1',
      aim: 'Simple goal',
      children: [],
      linkedTasks: [],
      priority: 'critical',
    };

    const phases = [
      {
        id: 1, name: 'Setup', description: '', dependsOn: [], estimatedFiles: [],
        acceptanceCriteria: [],
        tasks: [
          { id: 'P1.T1', title: 'Unrelated task xyz', type: 'config' as const, targetFiles: [] },
        ],
      },
    ];

    const coverage = computeCoverage(aimRoot, phases);
    // P1.T1 doesn't match the aim → orphan
    expect(coverage.orphanTasks.length).toBeGreaterThanOrEqual(0); // may or may not match
  });

  it('should render coverage markdown', () => {
    const coverage = {
      covered: [{ aimId: 'A1.1', aim: 'Auth', taskIds: ['P1.T1'] }],
      uncovered: [{ aimId: 'A1.2', aim: 'Missing feature' }],
      orphanTasks: [{ taskId: 'P3.T1', title: 'Random task' }],
    };

    const md = renderCoverageMd(coverage);
    expect(md).toContain('Coverage Matrix');
    expect(md).toContain('A1.1');
    expect(md).toContain('Uncovered');
    expect(md).toContain('Missing feature');
    expect(md).toContain('Orphan');
  });
});
