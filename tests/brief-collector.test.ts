/**
 * BriefCollector Tests
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { BriefCollector } from '../src/brief/brief-collector.js';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BriefScope, BriefAntiScope } from '../src/types/index.js';

const TEST_DIR = join(tmpdir(), `pc-brief-${Date.now()}`);

describe('BriefCollector', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('create (programmatic)', () => {
    it('should create a brief with scope and anti-scope', () => {
      const brief = BriefCollector.create(
        {
          whatToBuild: 'Multi-agent orchestration system',
          stack: 'typescript-node',
          successCriteria: ['Tests pass', 'TypeScript strict'],
        },
        {
          protectedFiles: ['MISSION.md', 'package.json'],
          lockedDecisions: ['D001', 'D002'],
          forbiddenDeps: ['express', 'mongoose'],
          breakingChanges: ['Mevcut API değişmesin'],
        }
      );

      expect(brief.scope.whatToBuild).toContain('orchestration');
      expect(brief.scope.stack).toBe('typescript-node');
      expect(brief.scope.successCriteria).toHaveLength(2);
      expect(brief.antiScope.protectedFiles).toContain('MISSION.md');
      expect(brief.antiScope.forbiddenDeps).toContain('express');
      expect(brief.collectedAt).toBeTruthy();
    });
  });

  describe('writeMission', () => {
    it('should append SCOPE and ANTI-SCOPE to MISSION.md', async () => {
      const missionPath = join(TEST_DIR, 'MISSION.md');
      await writeFile(missionPath, '# MISSION\n\n## Neden Varız\nTest project.\n');

      const collector = new BriefCollector();
      const brief = BriefCollector.create(
        {
          whatToBuild: 'Test system',
          stack: 'python',
          successCriteria: ['pytest passes', 'mypy clean'],
        },
        {
          protectedFiles: ['config.yml'],
          lockedDecisions: [],
          forbiddenDeps: ['flask'],
          breakingChanges: [],
        }
      );

      await collector.writeMission(brief, missionPath);

      const content = await readFile(missionPath, 'utf-8');
      expect(content).toContain('## SCOPE');
      expect(content).toContain('## ANTI-SCOPE');
      expect(content).toContain('## SUCCESS CRITERIA');
      expect(content).toContain('Test system');
      expect(content).toContain('Python');
      expect(content).toContain('pytest passes');
      expect(content).toContain('`config.yml`');
      expect(content).toContain('`flask`');
      // Original content preserved
      expect(content).toContain('# MISSION');
      expect(content).toContain('Test project');
    });

    it('should update existing SCOPE/ANTI-SCOPE sections', async () => {
      const missionPath = join(TEST_DIR, 'MISSION2.md');
      await writeFile(missionPath, `# MISSION

## Neden Varız
Original.

## SCOPE
Old scope.

## ANTI-SCOPE
Old anti-scope.

## SUCCESS CRITERIA
Old criteria.
`);

      const collector = new BriefCollector();
      const brief = BriefCollector.create(
        { whatToBuild: 'New scope', stack: 'go', successCriteria: ['go test passes'] },
        { protectedFiles: [], lockedDecisions: [], forbiddenDeps: [], breakingChanges: [] }
      );

      await collector.writeMission(brief, missionPath);

      const content = await readFile(missionPath, 'utf-8');
      expect(content).toContain('New scope');
      expect(content).not.toContain('Old scope');
      expect(content).toContain('Original.');
    });
  });

  describe('parseAntiScope', () => {
    it('should parse anti-scope from MISSION.md content', () => {
      const content = `# MISSION

## ANTI-SCOPE

**Dokunulmaz dosyalar**:
- \`MISSION.md\`
- \`package.json\`

**Kilitli kararlar**:
- D001 Dosya tabanlı hafıza

**Yasaklı bağımlılıklar**:
- \`express\`
- \`mongoose\`

**Kabul edilemez kırılmalar**:
- Mevcut testler kırılmasın
`;

      const antiScope = BriefCollector.parseAntiScope(content);
      expect(antiScope.protectedFiles).toEqual(['MISSION.md', 'package.json']);
      expect(antiScope.lockedDecisions).toEqual(['D001 Dosya tabanlı hafıza']);
      expect(antiScope.forbiddenDeps).toEqual(['express', 'mongoose']);
      expect(antiScope.breakingChanges).toEqual(['Mevcut testler kırılmasın']);
    });

    it('should return empty arrays when no ANTI-SCOPE section', () => {
      const antiScope = BriefCollector.parseAntiScope('# MISSION\nNo scope here.');
      expect(antiScope.protectedFiles).toEqual([]);
      expect(antiScope.forbiddenDeps).toEqual([]);
    });
  });

  describe('parseStackType', () => {
    it('should detect TypeScript from SCOPE', () => {
      const content = `## SCOPE\n**Stack**: TypeScript + Node.js\n`;
      expect(BriefCollector.parseStackType(content)).toBe('typescript-node');
    });

    it('should detect React', () => {
      const content = `## SCOPE\n**Stack**: React (TypeScript)\n`;
      expect(BriefCollector.parseStackType(content)).toBe('react');
    });

    it('should detect Python', () => {
      const content = `## SCOPE\n**Stack**: Python\n`;
      expect(BriefCollector.parseStackType(content)).toBe('python');
    });

    it('should return null when no SCOPE', () => {
      expect(BriefCollector.parseStackType('No scope here')).toBeNull();
    });
  });
});
