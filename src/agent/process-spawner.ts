/**
 * Process Spawner — Claude CLI Child Process Yönetimi
 * 
 * Claude Code binary'sini spawn eder, prompt'u stdin pipe ile gönderir,
 * stdout/stderr toplar, timeout yönetir.
 * 
 * Karar D004: Agent'lar Claude Code ile çalışır.
 * Karar D008: --print modu yeterli.
 * Karar D009: Uzun prompt'lar stdin pipe ile gönderilir (Windows cmd limit).
 */

import { spawn } from 'node:child_process';

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

/**
 * Windows cmd.exe arg limit: ~8191 chars.
 * Prompt'lar bu limiti aşınca stdin pipe veya temp dosya kullanılmalı.
 */
const WINDOWS_ARG_LIMIT = 7000; // safety margin

export class ProcessSpawner {
  private defaultBinary: string;
  private defaultTimeout: number;

  constructor(binaryPath = 'claude', timeout = 120_000) {
    this.defaultBinary = binaryPath;
    this.defaultTimeout = timeout;
  }

  /**
   * Claude CLI'ı --print modunda spawn et.
   * Kısa prompt → args ile, uzun prompt → stdin pipe ile.
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
    const envVars = {
      ...process.env,
      ...env,
      PC_AGENT_DEPTH: String(
        parseInt(process.env['PC_AGENT_DEPTH'] ?? '0', 10) + 1
      ),
    };

    // Flags varken veya uzun prompt: stdin pipe ile gönder (en güvenli)
    // Args-only sadece flagsiz kısa prompt'larda kullan
    if (flags.length > 0 || prompt.length > WINDOWS_ARG_LIMIT) {
      return this.spawnWithStdin(binaryPath, prompt, flags, cwd, timeout, envVars, startTime);
    }

    // Kısa prompt, flag yok: args ile gönder
    return this.runProcess({
      binary: binaryPath,
      args: ['--print', prompt],
      cwd,
      timeout,
      env: envVars,
      startTime,
      useStdin: false,
    });
  }

  /**
   * Uzun prompt'lar için: stdin pipe ile gönder.
   * claude --print -p "read from stdin" < prompt
   */
  private spawnWithStdin(
    binary: string,
    prompt: string,
    flags: string[],
    cwd: string,
    timeout: number,
    env: Record<string, string>,
    startTime: number,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      // stdin pipe açık, stdout/stderr pipe
      const child = spawn(binary, ['--print', ...flags], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('error', (error) => {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`Failed to spawn ${binary}: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr, duration: Date.now() - startTime, timedOut });
      });

      // Prompt'u stdin'e yaz ve kapat
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
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
        useStdin: false,
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
    useStdin: boolean;
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
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
      }, timeout);

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('error', (error) => {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`Failed to spawn ${binary}: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr, duration: Date.now() - startTime, timedOut });
      });
    });
  }
}
