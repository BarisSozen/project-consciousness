/**
 * CLI (pc) Tests — komut parse, help, version, status, log
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from 'node:child_process';

const TEST_DIR = join(tmpdir(), `pc-cli-${Date.now()}`);
const CLI_PATH = join(process.cwd(), 'src', 'bin', 'pc.ts');

function runCli(args: string, cwd = TEST_DIR): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(`npx tsx ${CLI_PATH} ${args}`, { cwd, timeout: 15_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error?.code ?? 0,
      });
    });
  });
}

describe('CLI: pc', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('pc help', () => {
    it('should display help message', async () => {
      const result = await runCli('help');
      expect(result.stdout).toContain('project-consciousness');
      expect(result.stdout).toContain('pc init');
      expect(result.stdout).toContain('pc run');
      expect(result.stdout).toContain('pc status');
      expect(result.stdout).toContain('pc log');
    });

    it('should display help with --help flag', async () => {
      const result = await runCli('--help');
      expect(result.stdout).toContain('project-consciousness');
    });

    it('should display help when no command given', async () => {
      const result = await runCli('');
      expect(result.stdout).toContain('pc init');
    });
  });

  describe('pc version', () => {
    it('should display version', async () => {
      const result = await runCli('version');
      expect(result.stdout).toContain('project-consciousness v0.1.0');
    });

    it('should work with --version flag', async () => {
      const result = await runCli('--version');
      expect(result.stdout).toContain('0.1.0');
    });
  });

  describe('pc status', () => {
    it('should show STATE.md content', async () => {
      await writeFile(join(TEST_DIR, 'STATE.md'), '# STATE\n## Current Phase: `executing`\n## Iteration: 5\n');
      const result = await runCli('status');
      expect(result.stdout).toContain('executing');
      expect(result.stdout).toContain('Iteration: 5');
    });

    it('should error when STATE.md missing', async () => {
      const result = await runCli('status');
      expect(result.stderr).toContain('STATE.md bulunamadı');
    });
  });

  describe('pc log', () => {
    it('should show DECISIONS.md content', async () => {
      await writeFile(join(TEST_DIR, 'DECISIONS.md'), '# DECISIONS\n## D001 — Test\nActive\n');
      const result = await runCli('log');
      expect(result.stdout).toContain('D001');
      expect(result.stdout).toContain('Test');
    });

    it('should error when DECISIONS.md missing', async () => {
      const result = await runCli('log');
      expect(result.stderr).toContain('DECISIONS.md bulunamadı');
    });
  });

  describe('pc run (no API key)', () => {
    it('should error when ANTHROPIC_API_KEY is not set', async () => {
      await writeFile(join(TEST_DIR, 'MISSION.md'), '# MISSION\nTest');
      // API key olmadan çalıştır
      const result = await runCli('run "test brief"');
      expect(result.stderr).toContain('ANTHROPIC_API_KEY');
    });
  });
});
