/**
 * Plan Generator Tests
 */

import { describe, it, expect } from 'vitest';
import { PlanGenerator } from '../src/planner/plan-generator.js';
import { FEATURE_DETECTORS } from '../src/planner/templates.js';
import type { Brief } from '../src/types/index.js';
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
