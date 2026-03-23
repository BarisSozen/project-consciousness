/**
 * Evaluator v2 Tests — Gerçek kontroller + anti-scope
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Evaluator } from '../src/orchestrator/evaluator.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { 
  AgentResult, 
  MemorySnapshot, 
  OrchestratorConfig 
} from '../src/types/index.js';

const TEST_DIR = join(tmpdir(), `pc-eval-${Date.now()}`);

const makeConfig = (): OrchestratorConfig => ({
  projectRoot: TEST_DIR,
  claudeApiKey: '', // No API key — real checks only
  model: 'claude-sonnet-4-20250514',
  maxRetries: 3,
  escalationThreshold: 0.4,
  maxParallelAgents: 3,
  verbose: false,
});

const makeMemory = (missionExtra = ''): MemorySnapshot => ({
  files: {
    mission: `# MISSION
## Neden Varız
Test.
## Ne İnşa Ediyoruz
Test.
## Başarı Tanımı
Test.
${missionExtra}`,
    architecture: '# ARCHITECTURE\nTest.',
    decisions: '# DECISIONS\n## D001\nTest.',
    state: '# STATE\n## Current Phase: `executing`\n## Iteration: 1',
  },
  timestamp: new Date().toISOString(),
  hash: 'test',
});

const makeResult = (overrides: Partial<AgentResult> = {}): AgentResult => ({
  taskId: 'T001',
  agentId: 'coder',
  success: true,
  output: 'Task completed successfully',
  artifacts: [],
  duration: 5000,
  ...overrides,
});

describe('Evaluator v2', () => {
  let evaluator: Evaluator;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    evaluator = new Evaluator(makeConfig());
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('detectStack', () => {
    it('should detect typescript-node from tsconfig.json', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'tsconfig.json'), '{}');
      const stack = await evaluator.detectStack(makeMemory());
      expect(stack).toBe('typescript-node');
    });

    it('should detect python from requirements.txt', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'requirements.txt'), 'flask\n');
      const stack = await evaluator.detectStack(makeMemory());
      expect(stack).toBe('python');
    });

    it('should detect react from package.json with react dep', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'package.json'), '{"dependencies":{"react":"^18"}}');
      const stack = await evaluator.detectStack(makeMemory());
      expect(stack).toBe('react');
    });

    it('should prefer MISSION.md explicit stack', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'tsconfig.json'), '{}');
      const memory = makeMemory('\n## SCOPE\n**Stack**: Python\n');
      const stack = await evaluator.detectStack(memory);
      expect(stack).toBe('python');
    });

    it('should return other when nothing detected', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      const stack = await evaluator.detectStack(makeMemory());
      expect(stack).toBe('other');
    });
  });

  describe('checkAntiScope', () => {
    it('should detect protected file violation', () => {
      const memory = makeMemory(`
## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- \`MISSION.md\`
- \`package.json\`

**Kilitli kararlar**:
- _(yok)_

**Yasaklı bağımlılıklar**:
- _(yok)_

**Kabul edilemez kırılmalar**:
- _(yok)_
`);
      const result = makeResult({ artifacts: ['MISSION.md', 'src/index.ts'] });
      const violations = evaluator.checkAntiScope(result, memory);

      expect(violations).toHaveLength(1);
      expect(violations[0]!.type).toBe('protected-file');
      expect(violations[0]!.file).toBe('MISSION.md');
    });

    it('should detect forbidden dependency', () => {
      const memory = makeMemory(`
## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- _(yok)_

**Kilitli kararlar**:
- _(yok)_

**Yasaklı bağımlılıklar**:
- \`express\`

**Kabul edilemez kırılmalar**:
- _(yok)_
`);
      const result = makeResult({ output: 'Added import express from "express"' });
      const violations = evaluator.checkAntiScope(result, memory);

      expect(violations).toHaveLength(1);
      expect(violations[0]!.type).toBe('forbidden-dep');
    });

    it('should return no violations when anti-scope is clean', () => {
      const memory = makeMemory(`
## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- \`secret.key\`

**Kilitli kararlar**:
- _(yok)_

**Yasaklı bağımlılıklar**:
- _(yok)_

**Kabul edilemez kırılmalar**:
- _(yok)_
`);
      const result = makeResult({ artifacts: ['src/new-file.ts'] });
      const violations = evaluator.checkAntiScope(result, memory);
      expect(violations).toHaveLength(0);
    });
  });

  describe('runStackChecks', () => {
    it('should run memory file existence checks for any stack', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'MISSION.md'), '# MISSION');
      await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), '# ARCH');
      await writeFile(join(TEST_DIR, 'DECISIONS.md'), '# DEC');
      await writeFile(join(TEST_DIR, 'STATE.md'), '# STATE');

      const checks = await evaluator.runStackChecks('other');

      const fileChecks = checks.filter(c => c.name.startsWith('File:'));
      expect(fileChecks).toHaveLength(4);
      expect(fileChecks.every(c => c.passed)).toBe(true);
    });

    it('should fail file check when file missing', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      const checks = await evaluator.runStackChecks('other');
      const missionCheck = checks.find(c => c.name === 'File: MISSION.md');
      expect(missionCheck).toBeDefined();
      expect(missionCheck!.passed).toBe(false);
    });

    it('should skip lint when config is missing', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });
      await writeFile(join(TEST_DIR, 'tsconfig.json'), '{}');
      // No eslint config

      const checks = await evaluator.runStackChecks('typescript-node');
      const lintCheck = checks.find(c => c.name === 'Lint');
      expect(lintCheck).toBeDefined();
      expect(lintCheck!.passed).toBe(true); // SKIP = pass
      expect(lintCheck!.output).toContain('SKIPPED');
    });

    it('should scope tests to agent artifacts', async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_DIR, { recursive: true });

      const checks = await evaluator.runStackChecks(
        'typescript-node',
        ['tests/calculator.test.ts']
      );
      const testCheck = checks.find(c => c.name === 'Unit tests');
      expect(testCheck).toBeDefined();
      // Command should include specific test file
      expect(testCheck!.command).toContain('calculator.test.ts');
    });
  });

  describe('evaluate (full)', () => {
    it('should return RealEvaluationResult with checks and violations', async () => {
      await writeFile(join(TEST_DIR, 'MISSION.md'), '# MISSION\n## Neden Varız\nT\n## Ne İnşa Ediyoruz\nT\n## Başarı Tanımı\nT');
      await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), '# ARCH');
      await writeFile(join(TEST_DIR, 'DECISIONS.md'), '# DEC');
      await writeFile(join(TEST_DIR, 'STATE.md'), '# STATE');

      const result = await evaluator.evaluate(
        makeResult(),
        makeMemory()
      );

      expect(result.taskId).toBe('T001');
      expect(result.checks).toBeDefined();
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.antiScopeViolations).toBeDefined();
      expect(result.stackDetected).toBeDefined();
      expect(result.verdict).toBeDefined();
      expect(result.feedback).toBeTruthy();
    });

    it('should escalate on anti-scope violation', async () => {
      await writeFile(join(TEST_DIR, 'MISSION.md'), '# M\n## Neden Varız\nT\n## Ne İnşa Ediyoruz\nT\n## Başarı Tanımı\nT');
      await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), '# A');
      await writeFile(join(TEST_DIR, 'DECISIONS.md'), '# D');
      await writeFile(join(TEST_DIR, 'STATE.md'), '# S');

      const memory = makeMemory(`
## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- \`sacred.txt\`

**Kilitli kararlar**:
- _(yok)_

**Yasaklı bağımlılıklar**:
- _(yok)_

**Kabul edilemez kırılmalar**:
- _(yok)_
`);
      const agentResult = makeResult({ artifacts: ['sacred.txt'] });

      const evalResult = await evaluator.evaluate(agentResult, memory);
      
      expect(evalResult.verdict).toBe('escalate');
      expect(evalResult.antiScopeViolations.length).toBeGreaterThan(0);
      expect(evalResult.issues.some(i => i.severity === 'critical')).toBe(true);
    });
  });
});
