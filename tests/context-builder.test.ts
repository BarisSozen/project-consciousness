/**
 * Context Builder Tests
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ContextBuilder } from '../src/agent/context-builder.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TaskDefinition, MemorySnapshot, AgentConfig } from '../src/types/index.js';

const TEST_DIR = join(tmpdir(), `pc-ctx-builder-${Date.now()}`);

const mockMemory: MemorySnapshot = {
  files: {
    mission: `# MISSION
## Neden Varız
Test mission
## Ne İnşa Ediyoruz
Multi-agent orchestration
## Başarı Tanımı
Agent'lar hafızayı kaybetmez`,
    architecture: `# ARCHITECTURE
## Tasarım İlkeleri
1. Memory-First
2. Fail-Safe
3. Append-Only Log`,
    decisions: `# DECISIONS
## D001 — TypeScript Stack
- **Tarih**: 2026-01-01
- **Karar**: TypeScript kullanılacak
- **Durum**: active

## D002 — File-Based Memory
- **Tarih**: 2026-01-01
- **Karar**: Dosya tabanlı hafıza
- **Durum**: active`,
    state: `# STATE
## Current Phase: \`executing\`
## Iteration: 3`,
  },
  timestamp: '2026-01-01T00:00:00Z',
  hash: 'abc123def456',
};

const mockTask: TaskDefinition = {
  id: 'T001',
  title: 'Implement memory layer',
  description: 'Create the memory persistence layer',
  type: 'code',
  dependencies: [],
  priority: 'high',
  estimatedComplexity: 'moderate',
  acceptanceCriteria: [
    'Memory files are read correctly',
    'State updates work',
    'Decisions append-only',
  ],
};

const mockAgent: AgentConfig = {
  id: 'coder',
  type: 'coder',
  capabilities: ['write-code'],
};

describe('ContextBuilder', () => {
  const builder = new ContextBuilder();

  it('should build prompt containing all memory sections', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    
    expect(prompt).toContain('MISSION');
    expect(prompt).toContain('ARCHITECTURE');
    expect(prompt).toContain('DECISIONS');
    expect(prompt).toContain('STATE');
  });

  it('should include task details', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    
    expect(prompt).toContain('T001');
    expect(prompt).toContain('Implement memory layer');
    expect(prompt).toContain('Memory files are read correctly');
  });

  it('should include agent persona for coder', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    
    expect(prompt).toContain('yazılım mühendisisin');
    expect(prompt).toContain('MISSION.md');
  });

  it('should include agent persona for reviewer', () => {
    const reviewer: AgentConfig = { id: 'reviewer', type: 'reviewer', capabilities: [] };
    const prompt = builder.buildPrompt(mockTask, mockMemory, reviewer);
    
    expect(prompt).toContain('review uzmanısın');
    expect(prompt).toContain('PASS/WARN/FAIL');
  });

  it('should include scope warning', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    
    expect(prompt).toContain('KAPSAM UYARISI');
    expect(prompt).toContain('scope creep');
  });

  it('should include output format', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    
    expect(prompt).toContain('## Sonuç');
    expect(prompt).toContain('## Yapılanlar');
    expect(prompt).toContain('Kabul Kriterleri Kontrolü');
  });

  it('should build compact memory for large contexts', () => {
    const largeMission = mockMemory.files.mission;
    const largeArch = 'x'.repeat(20_000);
    const largeDecisions = 'y'.repeat(15_000);
    const largeMemory: MemorySnapshot = {
      ...mockMemory,
      files: {
        ...mockMemory.files,
        architecture: largeArch,
        decisions: largeDecisions,
      },
    };

    const context = builder.buildMemoryContext(largeMemory);
    // Should use compact version — shorter than full
    expect(context.length).toBeLessThan(largeArch.length + largeDecisions.length);
    // Mission should still be fully included
    expect(context).toContain(largeMission);
  });

  // ── Codebase Context entegrasyonu ─────────────────────

  it('should include codebase context in prompt when provided', () => {
    const codebaseContext = {
      files: [
        {
          path: 'src/auth/auth-service.ts',
          firstLines: 'export class AuthService { ... }',
          exports: ['AuthService', 'hashPassword'],
          relevanceScore: 10,
        },
      ],
      totalTokens: 500,
      truncated: false,
      summary: '### src/auth/auth-service.ts\nExports: AuthService, hashPassword\n```\nexport class AuthService { ... }\n```',
    };

    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent, codebaseContext);

    expect(prompt).toContain('MEVCUT CODEBASE');
    expect(prompt).toContain('AuthService');
    expect(prompt).toContain('auth-service.ts');
  });

  it('should not include codebase section when no context', () => {
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent);
    expect(prompt).not.toContain('MEVCUT CODEBASE');
  });

  it('should not include codebase section when empty files', () => {
    const emptyContext = {
      files: [],
      totalTokens: 0,
      truncated: false,
      summary: '',
    };
    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent, emptyContext);
    expect(prompt).not.toContain('MEVCUT CODEBASE');
  });

  it('should show truncation warning when codebase is truncated', () => {
    const truncatedContext = {
      files: [
        {
          path: 'src/index.ts',
          firstLines: 'export const x = 1;',
          exports: ['x'],
          relevanceScore: 1,
        },
      ],
      totalTokens: 8000,
      truncated: true,
      summary: '### src/index.ts\n```\nexport const x = 1;\n```',
    };

    const prompt = builder.buildPrompt(mockTask, mockMemory, mockAgent, truncatedContext);

    expect(prompt).toContain('MEVCUT CODEBASE');
    expect(prompt).toContain('Token limiti nedeniyle');
  });

  // ── buildCodebaseContext ────────────────────────────

  describe('buildCodebaseContext', () => {
    beforeEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(join(TEST_DIR, 'src', 'auth'), { recursive: true });
      await writeFile(
        join(TEST_DIR, 'src', 'auth', 'service.ts'),
        'export class AuthService {\n  login() {}\n  register() {}\n}\n'
      );
      await writeFile(
        join(TEST_DIR, 'src', 'index.ts'),
        'export { AuthService } from "./auth/service.js";\n'
      );
    });

    afterAll(async () => {
      await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    });

    it('should build codebase context for auth task', async () => {
      const context = await builder.buildCodebaseContext(
        TEST_DIR,
        'auth endpoint yaz'
      );

      expect(context.files.length).toBeGreaterThan(0);
      expect(context.totalTokens).toBeGreaterThan(0);
      expect(context.totalTokens).toBeLessThanOrEqual(8000);
    });

    it('should use architecture for better relevance', async () => {
      const context = await builder.buildCodebaseContext(
        TEST_DIR,
        'service güncelle',
        '## Auth Layer\nsrc/auth/ altında auth servisi bulunur.'
      );

      const paths = context.files.map(f => f.path);
      expect(paths.some(p => p.includes('auth'))).toBe(true);
    });
  });
});

