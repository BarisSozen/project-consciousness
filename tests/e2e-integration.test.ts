/**
 * T004 — End-to-End Integration Test
 * 
 * Gerçek claude CLI ile tam akışı test eder:
 * 1. ProcessSpawner → claude.exe --print spawn
 * 2. ContextBuilder → memory-aware prompt
 * 3. OutputParser → markdown → AgentResult
 * 4. MemoryLayer → state güncelleme
 * 
 * ÖNEMLİ: Bu test GERÇEK claude CLI çağrısı yapar.
 * `claude.exe --print` mevcut olmalı ve çalışmalı.
 * CI'da skip edilmeli: env SKIP_E2E=1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProcessSpawner } from '../src/agent/process-spawner.js';
import { ContextBuilder } from '../src/agent/context-builder.js';
import { OutputParser } from '../src/agent/output-parser.js';
import { AgentRunner } from '../src/agent/agent-runner.js';
import { MemoryLayer } from '../src/memory/memory-layer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TaskDefinition, MemorySnapshot, AgentConfig } from '../src/types/index.js';

// ── Test Environment Setup ────────────────────────────────

const SKIP = process.env['SKIP_E2E'] === '1';
const TEST_DIR = join(tmpdir(), `pc-e2e-${Date.now()}`);
const CLAUDE_BINARY = 'claude.exe';

// Gerçek hafıza dosyalarının minimal versiyonu
const MINI_MISSION = `# MISSION
## Neden Varız
E2E test için minimal mission.
## Ne İnşa Ediyoruz
Test sistemi.
## Başarı Tanımı
Testler geçmeli.`;

const MINI_ARCH = `# ARCHITECTURE
TypeScript + Node.js. Dosya tabanlı hafıza.`;

const MINI_DECISIONS = `# DECISIONS
## D001 — Test Decision
- **Tarih**: 2026-03-24
- **Karar**: E2E test kararı
- **Durum**: active`;

const MINI_STATE = `# STATE
## Current Phase: \`executing\`
## Iteration: 1
## Active Tasks
- [ ] T001 — E2E test task — status: pending
## Completed Tasks
_henüz yok_
## Blocked
_henüz yok_
## Last Updated: 2026-03-24T00:00:00Z`;

async function setupE2EFiles(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  await writeFile(join(TEST_DIR, 'MISSION.md'), MINI_MISSION);
  await writeFile(join(TEST_DIR, 'ARCHITECTURE.md'), MINI_ARCH);
  await writeFile(join(TEST_DIR, 'DECISIONS.md'), MINI_DECISIONS);
  await writeFile(join(TEST_DIR, 'STATE.md'), MINI_STATE);
}

// ── Tests ─────────────────────────────────────────────────

describe.skipIf(SKIP)('E2E: Real Claude CLI Integration', () => {
  let spawner: ProcessSpawner;

  beforeAll(async () => {
    await setupE2EFiles();
    spawner = new ProcessSpawner(CLAUDE_BINARY, 60_000);
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  // ── Layer 1: ProcessSpawner Health Check ──────────────

  it('should detect claude CLI is available', async () => {
    const health = await spawner.healthCheck();

    console.log(`  🏥 Health: available=${health.available}, version=${health.version}`);

    expect(health.available).toBe(true);
    expect(health.version).toBeTruthy();
    expect(health.version).toMatch(/\d+\.\d+/);
  }, 15_000);

  // ── Layer 2: Raw Process Spawn ────────────────────────

  it('should spawn claude --print and get response', async () => {
    const result = await spawner.spawn({
      prompt: 'Respond with exactly: E2E_TEST_OK',
      cwd: TEST_DIR,
    });

    console.log(`  ⚡ Spawn: exit=${result.exitCode}, duration=${result.duration}ms, timedOut=${result.timedOut}`);
    console.log(`  📤 stdout (first 200): ${result.stdout.slice(0, 200)}`);

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBeTruthy();
    expect(result.stdout.length).toBeGreaterThan(0);
    // Agent bir şey döndürmeli (tam "E2E_TEST_OK" olmasa bile)
    expect(result.duration).toBeGreaterThan(0);
  }, 60_000);

  // ── Layer 3: Context Builder → Spawn → Parse ──────────

  it('should build context, spawn agent, and parse output', async () => {
    const memory: MemorySnapshot = {
      files: {
        mission: MINI_MISSION,
        architecture: MINI_ARCH,
        decisions: MINI_DECISIONS,
        state: MINI_STATE,
      },
      timestamp: new Date().toISOString(),
      hash: 'e2e-test-hash',
    };

    const task: TaskDefinition = {
      id: 'T-E2E-001',
      title: 'Describe this project in one sentence',
      description: 'Read the MISSION.md and describe what this project does in one sentence. Do NOT modify any files.',
      type: 'document',
      dependencies: [],
      priority: 'medium',
      estimatedComplexity: 'trivial',
      acceptanceCriteria: [
        'One sentence description provided',
        'Description aligns with MISSION.md',
      ],
    };

    const agent: AgentConfig = {
      id: 'documenter',
      type: 'documenter',
      capabilities: ['write-docs'],
    };

    // 1. Context build
    const contextBuilder = new ContextBuilder();
    const prompt = contextBuilder.buildPrompt(task, memory, agent);

    console.log(`  📝 Prompt length: ${prompt.length} chars`);
    expect(prompt).toContain('MISSION');
    expect(prompt).toContain('T-E2E-001');
    expect(prompt).toContain('one sentence');

    // 2. Spawn
    const processResult = await spawner.spawn({
      prompt,
      cwd: TEST_DIR,
    });

    console.log(`  ⚡ Spawn: exit=${processResult.exitCode}, duration=${processResult.duration}ms`);
    console.log(`  📤 stdout (first 300): ${processResult.stdout.slice(0, 300)}`);

    expect(processResult.exitCode).toBe(0);
    expect(processResult.stdout.length).toBeGreaterThan(0);

    // 3. Parse
    const outputParser = new OutputParser();
    const agentResult = outputParser.parse(
      task.id,
      agent.id,
      processResult.stdout,
      processResult.stderr,
      processResult.exitCode,
      processResult.duration
    );

    console.log(`  📊 AgentResult: success=${agentResult.success}, taskId=${agentResult.taskId}`);
    console.log(`  📊 Output (first 200): ${agentResult.output.slice(0, 200)}`);
    console.log(`  📊 Artifacts: ${agentResult.artifacts.join(', ') || 'none'}`);
    console.log(`  📊 Duration: ${agentResult.duration}ms`);

    expect(agentResult.taskId).toBe('T-E2E-001');
    expect(agentResult.agentId).toBe('documenter');
    expect(agentResult.success).toBe(true);
    expect(agentResult.output).toBeTruthy();
    expect(agentResult.duration).toBeGreaterThan(0);
  }, 90_000);

  // ── Layer 4: Full AgentRunner E2E ─────────────────────

  it('should run full AgentRunner.runTask with real claude', async () => {
    const runner = new AgentRunner({
      binaryPath: CLAUDE_BINARY,
      workingDirectory: TEST_DIR,
      timeout: 60_000,
      maxDepth: 3,
      log: (msg) => console.log(`    ${msg}`),
    });

    // Health check
    const health = await runner.checkHealth();
    console.log(`  🏥 AgentRunner health: ready=${health.ready}`);
    expect(health.ready).toBe(true);

    const memory: MemorySnapshot = {
      files: {
        mission: MINI_MISSION,
        architecture: MINI_ARCH,
        decisions: MINI_DECISIONS,
        state: MINI_STATE,
      },
      timestamp: new Date().toISOString(),
      hash: 'e2e-full-hash',
    };

    const task: TaskDefinition = {
      id: 'T-E2E-002',
      title: 'List the memory files',
      description: 'List the 4 memory files (MISSION.md, ARCHITECTURE.md, DECISIONS.md, STATE.md) and explain what each one does in one line. Do NOT create or modify any files. Just respond with text.',
      type: 'document',
      dependencies: [],
      priority: 'medium',
      estimatedComplexity: 'trivial',
      acceptanceCriteria: [
        'All 4 files listed',
        'Each file has a one-line explanation',
      ],
    };

    const result = await runner.runTask(task, memory);

    console.log(`\n  ═══ AgentRunner Result ═══`);
    console.log(`  taskId: ${result.taskId}`);
    console.log(`  agentId: ${result.agentId}`);
    console.log(`  success: ${result.success}`);
    console.log(`  duration: ${result.duration}ms`);
    console.log(`  artifacts: [${result.artifacts.join(', ')}]`);
    console.log(`  output (first 400):\n${result.output.slice(0, 400)}`);
    console.log(`  ═══════════════════════\n`);

    expect(result.taskId).toBe('T-E2E-002');
    expect(result.agentId).toBe('documenter');
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.output.length).toBeGreaterThan(10);
    expect(result.duration).toBeGreaterThan(0);
  }, 90_000);

  // ── Layer 5: Memory State Update After Agent Run ──────

  it('should update STATE.md after agent completion', async () => {
    const memoryLayer = new MemoryLayer(TEST_DIR);

    // Parse initial state
    const stateBefore = await memoryLayer.parseState();
    expect(stateBefore.phase).toBe('executing');
    expect(stateBefore.completedTasks.length).toBe(0);

    // Simulate task completion by updating state
    stateBefore.completedTasks.push({
      taskId: 'T-E2E-002',
      title: 'List the memory files',
      status: 'done',
      assignedAgent: 'documenter',
      completedAt: new Date().toISOString(),
      output: 'Agent completed successfully',
    });
    stateBefore.activeTasks = stateBefore.activeTasks.filter(
      t => t.taskId !== 'T-E2E-002'
    );
    stateBefore.lastUpdated = new Date().toISOString();

    await memoryLayer.updateState(stateBefore);

    // Verify
    const stateAfter = await memoryLayer.parseState();
    expect(stateAfter.completedTasks.length).toBe(1);

    const content = await memoryLayer.readState();
    console.log(`  📋 Updated STATE.md:\n${content.slice(0, 400)}`);
    expect(content).toContain('T-E2E-002');
    expect(content).toContain('Agent completed successfully');
  });
});

// ── Smoke Test (always runs, no real CLI) ─────────────────

describe('E2E: Smoke Test (no real CLI)', () => {
  it('should verify e2e test infrastructure works', async () => {
    await setupE2EFiles();
    const memory = new MemoryLayer(TEST_DIR);
    
    const snapshot = await memory.snapshot();
    expect(snapshot.files.mission).toContain('Neden Varız');
    expect(snapshot.files.state).toContain('executing');
    expect(snapshot.hash).toBeTruthy();

    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });
});
