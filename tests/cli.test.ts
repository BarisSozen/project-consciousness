/**
 * CLI (csns) Tests — command parse, help, version, status, log
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from 'node:child_process';

const TEST_DIR = join(tmpdir(), `csns-cli-${Date.now()}`);
const CLI_PATH = join(process.cwd(), 'src', 'bin', 'csns.ts');

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

describe('CLI: csns', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('csns help', () => {
    it('should display help message', async () => {
      const result = await runCli('help');
      expect(result.stdout).toContain('CSNS');
      expect(result.stdout).toContain('/new');
      expect(result.stdout).toContain('/audit');
      expect(result.stdout).toContain('/trace');
      expect(result.stdout).toContain('/status');
      expect(result.stdout).toContain('/log');
    });

    it('should display help with --help flag', async () => {
      const result = await runCli('--help');
      expect(result.stdout).toContain('CSNS');
    });
  });

  describe('csns version', () => {
    it('should display version', async () => {
      const result = await runCli('version');
      expect(result.stdout).toContain('csns v0.6.0');
    });

    it('should work with --version flag', async () => {
      const result = await runCli('--version');
      expect(result.stdout).toContain('0.6.0');
    });
  });

  describe('csns status', () => {
    it('should show STATE.md content', async () => {
      await writeFile(join(TEST_DIR, 'STATE.md'), '# STATE\n## Current Phase: `executing`\n## Iteration: 5\n');
      const result = await runCli('status');
      expect(result.stdout).toContain('executing');
      expect(result.stdout).toContain('Iteration: 5');
    });

    it('should error when STATE.md missing', async () => {
      const result = await runCli('status');
      expect(result.stderr).toContain('STATE.md not found');
    });
  });

  describe('csns log', () => {
    it('should show DECISIONS.md content', async () => {
      await writeFile(join(TEST_DIR, 'DECISIONS.md'), '# DECISIONS\n## D001 — Test\nActive\n');
      const result = await runCli('log');
      expect(result.stdout).toContain('D001');
      expect(result.stdout).toContain('Test');
    });

    it('should error when DECISIONS.md missing', async () => {
      const result = await runCli('log');
      expect(result.stderr).toContain('DECISIONS.md not found');
    });
  });

  describe('csns health', () => {
    it('should check LLM and agent status', async () => {
      const result = await runCli('health');
      // Should at least show agent CLI check
      expect(result.stdout).toContain('Agent CLI');
    });
  });

  describe('csns unknown command', () => {
    it('should error on unknown command', async () => {
      const result = await runCli('foobar');
      expect(result.stderr).toContain('Unknown command');
    });
  });
});
