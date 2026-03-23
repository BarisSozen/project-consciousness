/**
 * Process Spawner — Claude CLI Child Process Yönetimi
 * 
 * Claude Code binary'sini spawn eder, stdin'den prompt gönderir,
 * stdout/stderr toplar, timeout yönetir.
 * 
 * Karar D004: Agent'lar Claude Code ile çalışır (dosya sistemi erişimi gerekli).
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface SpawnOptions {
  /** Prompt to send to claude CLI */
  prompt: string;
  /** Working directory for the agent */
  cwd: string;
  /** Timeout in milliseconds (default: 120_000) */
  timeout?: number;
  /** Claude CLI binary path (default: 'claude') */
  binaryPath?: string;
  /** Additional CLI flags */
  flags?: string[];
  /** Environment variables to inject */
  env?: Record<string, string>;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export class ProcessSpawner {
  private defaultBinary: string;
  private defaultTimeout: number;

  constructor(binaryPath = 'claude', timeout = 120_000) {
    this.defaultBinary = binaryPath;
    this.defaultTimeout = timeout;
  }

  /**
   * Claude CLI'ı --print modunda spawn et.
   * --print: sadece text çıktı, interaktif UI yok.
   */
  async spawn(options: SpawnOptions): Promise<ProcessResult> {
    const {
      prompt,
      cwd,
      timeout = this.defaultTimeout,
      binaryPath = this.defaultBinary,
      flags = [],
      env = {},
    } = options;

    const startTime = Date.now();

    // Uzun prompt'lar için temp dosya kullan
    const promptFile = await this.writePromptFile(prompt);

    try {
      return await this.runProcess({
        binary: binaryPath,
        args: [
          '--print',             // non-interactive, text-only output
          '--verbose',           // include reasoning
          ...flags,
          prompt,
        ],
        cwd,
        timeout,
        env: {
          ...process.env,
          ...env,
          // Agent'ın kendi subagent spawn etmesini engelle (sonsuz döngü koruması)
          PC_AGENT_DEPTH: String(
            parseInt(process.env['PC_AGENT_DEPTH'] ?? '0', 10) + 1
          ),
        },
        startTime,
      });
    } finally {
      // Temp dosyayı temizle
      await this.cleanupPromptFile(promptFile);
    }
  }

  /**
   * Sağlık kontrolü — claude binary erişilebilir mi?
   */
  async healthCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = await this.runProcess({
        binary: this.defaultBinary,
        args: ['--version'],
        cwd: process.cwd(),
        timeout: 10_000,
        env: process.env as Record<string, string>,
        startTime: Date.now(),
      });

      if (result.exitCode === 0) {
        return { available: true, version: result.stdout.trim() };
      }
      return { available: false, error: `Exit code: ${result.exitCode}` };
    } catch (error) {
      return { 
        available: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // ── Private ─────────────────────────────────────────────

  private runProcess(opts: {
    binary: string;
    args: string[];
    cwd: string;
    timeout: number;
    env: Record<string, string>;
    startTime: number;
  }): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const { binary, args, cwd, timeout, env, startTime } = opts;

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(binary, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Windows uyumluluğu
        shell: process.platform === 'win32',
      });

      // Timeout yönetimi
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Grace period sonrası zorla öldür
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 5_000);
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`Failed to spawn ${binary}: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        settled = true;
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          timedOut,
        });
      });

      // stdin'i kapat (prompt args ile gönderildi)
      child.stdin?.end();
    });
  }

  private async writePromptFile(prompt: string): Promise<string | null> {
    // 4KB altı prompt'lar için dosya gereksiz
    if (prompt.length < 4096) return null;

    const dir = await mkdtemp(join(tmpdir(), 'pc-prompt-'));
    const filePath = join(dir, 'prompt.md');
    await writeFile(filePath, prompt, 'utf-8');
    return filePath;
  }

  private async cleanupPromptFile(filePath: string | null): Promise<void> {
    if (!filePath) return;
    try {
      await unlink(filePath);
    } catch {
      // Best effort cleanup
    }
  }
}
