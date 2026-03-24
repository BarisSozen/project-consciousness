/**
 * LLM Output Guard — Vibe Coding Sınırlamalarını Yakalayan Kontroller
 *
 * LLM'lerin bilinen hatalarını agent çıktısı üzerinde kontrol eder:
 *
 * 1. Package Hallucination Guard — npm registry'de var mı?
 * 2. API Freshness Guard — deprecated/outdated API kullanımı
 * 3. Interface Contract Guard — iki dosya arasında type uyumsuzluğu
 * 4. Style Consistency Guard — aynı pattern farklı mı yazılmış?
 * 5. Scope Creep Guard — brief'te olmayan şeyler eklenmiş mi?
 * 6. Error Handling Guard — boş catch blokları, unhandled promise
 * 7. Dependency Bloat Guard — gereksiz paket eklenmesi
 * 8. Env Completeness Guard — kullanılan env var tanımlı mı?
 */

import { execSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface GuardFinding {
  guard: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  description: string;
  fix: string;
}

export interface GuardReport {
  findings: GuardFinding[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    guardsPassed: string[];
    guardsFailed: string[];
  };
  duration: number;
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

// ═══════════════════════════════════════════════════════════
// Guards
// ═══════════════════════════════════════════════════════════

export class LLMOutputGuard {
  private root: string;
  private brief?: string;

  constructor(projectRoot: string, brief?: string) {
    this.root = projectRoot;
    this.brief = brief;
  }

  async check(): Promise<GuardReport> {
    const start = Date.now();
    const files = await this.collectFiles();
    const findings: GuardFinding[] = [];

    const pkg = await this.readPackageJson();
    const fileContents = new Map<string, string>();
    for (const f of files) {
      try { fileContents.set(f, await readFile(join(this.root, f), 'utf-8')); } catch { /* skip */ }
    }

    // Run all guards
    const guards: Array<{ name: string; run: () => Promise<GuardFinding[]> }> = [
      { name: 'package-hallucination', run: () => this.guardPackageHallucination(pkg, fileContents) },
      { name: 'deprecated-api', run: () => this.guardDeprecatedAPI(fileContents) },
      { name: 'empty-catch', run: () => this.guardEmptyCatch(fileContents) },
      { name: 'unhandled-promise', run: () => this.guardUnhandledPromise(fileContents) },
      { name: 'dependency-bloat', run: () => this.guardDependencyBloat(pkg, fileContents) },
      { name: 'env-completeness', run: () => this.guardEnvCompleteness(fileContents) },
      { name: 'scope-creep', run: () => this.guardScopeCreep(fileContents) },
      { name: 'style-consistency', run: () => this.guardStyleConsistency(fileContents) },
      { name: 'todo-fixme', run: () => this.guardTodoFixme(fileContents) },
      { name: 'magic-numbers', run: () => this.guardMagicNumbers(fileContents) },
    ];

    const guardsPassed: string[] = [];
    const guardsFailed: string[] = [];

    for (const guard of guards) {
      const results = await guard.run();
      findings.push(...results);
      if (results.length === 0) guardsPassed.push(guard.name);
      else guardsFailed.push(guard.name);
    }

    return {
      findings,
      summary: {
        total: findings.length,
        errors: findings.filter(f => f.severity === 'error').length,
        warnings: findings.filter(f => f.severity === 'warning').length,
        guardsPassed,
        guardsFailed,
      },
      duration: Date.now() - start,
    };
  }

  // ── Guard 1: Package Hallucination ──────────────────────

  private async guardPackageHallucination(
    pkg: Record<string, unknown> | null,
    _files: Map<string, string>
  ): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];
    if (!pkg) return findings;

    const allDeps = new Set([
      ...Object.keys((pkg.dependencies ?? {}) as Record<string, string>),
      ...Object.keys((pkg.devDependencies ?? {}) as Record<string, string>),
    ]);

    // Check each dep exists on npm (cached, skip known-good)
    const knownGood = new Set(['express', 'zod', 'typescript', 'vitest', 'react', 'next', 'vite',
      'drizzle-orm', 'prisma', '@prisma/client', 'jsonwebtoken', 'bcrypt', 'cors', 'helmet',
      'dotenv', 'chalk', 'ora', 'tsx', 'prettier', 'eslint', 'supertest', 'date-fns',
      'gray-matter', '@anthropic-ai/sdk', '@types/node', '@types/express', '@types/supertest']);

    for (const dep of allDeps) {
      if (dep.startsWith('@types/')) continue;
      if (knownGood.has(dep)) continue;

      try {
        execSync(`npm view ${dep} version`, { timeout: 5_000, encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        findings.push({
          guard: 'package-hallucination',
          severity: 'error',
          file: 'package.json',
          line: 0,
          description: `Package '${dep}' not found on npm registry — possible hallucinated dependency`,
          fix: `Verify this package exists. If not, remove it and use an alternative or implement the functionality directly.`,
        });
      }
    }

    return findings;
  }

  // ── Guard 2: Deprecated API Usage ───────────────────────

  private async guardDeprecatedAPI(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    const deprecatedPatterns: Array<{ pattern: RegExp; message: string; fix: string }> = [
      { pattern: /new Buffer\(/g, message: 'Buffer constructor is deprecated', fix: 'Use Buffer.from() or Buffer.alloc()' },
      { pattern: /\.substr\(/g, message: '.substr() is deprecated', fix: 'Use .substring() or .slice()' },
      { pattern: /require\(['"]path['"]\)/g, message: "require('path') in ESM project", fix: "Use import { join } from 'node:path'" },
      { pattern: /bodyParser\./g, message: 'body-parser is built into Express 4.16+', fix: 'Use express.json() and express.urlencoded()' },
      { pattern: /app\.use\(express\.bodyParser/g, message: 'express.bodyParser is removed in Express 5', fix: 'Use express.json()' },
      { pattern: /mongoose\.connect\([^)]*{[^}]*useNewUrlParser/g, message: 'useNewUrlParser is deprecated in Mongoose 6+', fix: 'Remove the option — it is default now' },
      { pattern: /\.then\(\s*function/g, message: 'function() in .then() — use arrow function', fix: 'Use .then((result) => ...)' },
      { pattern: /var\s+\w+\s*=/g, message: 'var usage — use const or let', fix: 'Replace var with const (or let if reassigned)' },
    ];

    for (const [file, content] of files) {
      if (this.isTestFile(file)) continue;
      for (const dp of deprecatedPatterns) {
        const regex = new RegExp(dp.pattern.source, dp.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          findings.push({
            guard: 'deprecated-api',
            severity: 'warning',
            file,
            line: this.getLineNumber(content, match.index),
            description: dp.message,
            fix: dp.fix,
          });
        }
      }
    }

    return findings;
  }

  // ── Guard 3: Empty Catch Blocks ─────────────────────────

  private async guardEmptyCatch(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    for (const [file, content] of files) {
      if (this.isTestFile(file)) continue;
      // catch (e) {} or catch { } — empty body
      const regex = /catch\s*(?:\([^)]*\))?\s*{\s*}/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        findings.push({
          guard: 'empty-catch',
          severity: 'warning',
          file,
          line: this.getLineNumber(content, match.index),
          description: 'Empty catch block — errors are silently swallowed',
          fix: 'At minimum, log the error: catch (e) { console.error(e); }',
        });
      }
    }

    return findings;
  }

  // ── Guard 4: Unhandled Promise ──────────────────────────

  private async guardUnhandledPromise(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    for (const [file, content] of files) {
      if (this.isTestFile(file)) continue;
      // Floating promise — async call without await, .then, or .catch
      // Heuristic: lines that start with a function call that returns promise but no await
      const regex = /^\s+(?!return|await|const|let|var|if|for|while|export|import|\/\/)(\w+\.\w+)\([^)]*\)\s*;?\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const callName = match[1] ?? '';
        // Skip known void calls
        if (/^console\.|^process\.|\.log|\.warn|\.error|\.push|\.set|\.delete|\.clear|\.close|\.end|\.write|\.emit|\.removeListener/i.test(callName)) continue;
        // Check if it looks like an async function (common async indicators)
        if (/fetch|query|save|create|update|delete|find|send|publish|connect/i.test(callName)) {
          findings.push({
            guard: 'unhandled-promise',
            severity: 'warning',
            file,
            line: this.getLineNumber(content, match.index),
            description: `Possible floating promise: ${callName}() — result not awaited or caught`,
            fix: 'Add await, .catch(), or void prefix if intentionally fire-and-forget',
          });
        }
      }
    }

    return findings;
  }

  // ── Guard 5: Dependency Bloat ───────────────────────────

  private async guardDependencyBloat(
    pkg: Record<string, unknown> | null,
    files: Map<string, string>
  ): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];
    if (!pkg) return findings;

    const deps = Object.keys((pkg.dependencies ?? {}) as Record<string, string>);

    // Packages that are commonly unnecessary
    const bloatIndicators: Record<string, string> = {
      'lodash': 'Most lodash functions have native alternatives (Array.map, Object.entries, etc.)',
      'underscore': 'Superseded by native JS methods',
      'moment': 'Deprecated — use date-fns or Temporal API',
      'request': 'Deprecated — use native fetch() (Node 18+)',
      'node-fetch': 'Native fetch() available in Node 18+',
      'axios': 'Consider native fetch() — one less dependency',
      'uuid': 'Consider crypto.randomUUID() (Node 19+)',
      'bluebird': 'Native Promise is sufficient in modern Node.js',
      'async': 'Native async/await replaces most async.js patterns',
    };

    for (const dep of deps) {
      const suggestion = bloatIndicators[dep];
      if (suggestion) {
        // Check if actually imported
        const isUsed = [...files.values()].some(c =>
          c.includes(`from '${dep}'`) || c.includes(`from "${dep}"`) || c.includes(`require('${dep}')`)
        );
        if (isUsed) {
          findings.push({
            guard: 'dependency-bloat',
            severity: 'info',
            file: 'package.json',
            line: 0,
            description: `'${dep}' may be unnecessary — ${suggestion}`,
            fix: `Consider removing and using the native alternative`,
          });
        }
      }
    }

    return findings;
  }

  // ── Guard 6: Env Completeness ───────────────────────────

  private async guardEnvCompleteness(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    // Collect used env vars
    const usedEnvVars = new Map<string, { file: string; line: number }>();
    for (const [file, content] of files) {
      const regex = /process\.env\[?['"]?([A-Z_][A-Z0-9_]+)['"]?\]?/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        if (match[1] && !usedEnvVars.has(match[1])) {
          usedEnvVars.set(match[1], { file, line: this.getLineNumber(content, match.index) });
        }
      }
    }

    // Check .env.example
    const envExampleVars = new Set<string>();
    try {
      const envExample = await readFile(join(this.root, '.env.example'), 'utf-8');
      for (const line of envExample.split('\n')) {
        const match = line.match(/^([A-Z_][A-Z0-9_]+)\s*=/);
        if (match?.[1]) envExampleVars.add(match[1]);
      }
    } catch { /* no .env.example */ }

    const builtins = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'USER', 'PWD', 'TERM', 'TZ', 'CI', 'SHELL']);

    for (const [envVar, location] of usedEnvVars) {
      if (builtins.has(envVar)) continue;
      if (!envExampleVars.has(envVar)) {
        findings.push({
          guard: 'env-completeness',
          severity: 'warning',
          file: location.file,
          line: location.line,
          description: `Env var '${envVar}' used but not documented in .env.example`,
          fix: `Add ${envVar}= to .env.example with a description`,
        });
      }
    }

    return findings;
  }

  // ── Guard 7: Scope Creep ────────────────────────────────

  private async guardScopeCreep(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];
    if (!this.brief) return findings;

    const briefLower = this.brief.toLowerCase();

    // Check for common scope creep indicators
    const creepIndicators: Array<{ pattern: RegExp; feature: string; keywords: string[] }> = [
      { pattern: /stripe|payment|billing|checkout|subscription/gi, feature: 'payment system', keywords: ['payment', 'stripe', 'billing', 'checkout'] },
      { pattern: /sendgrid|nodemailer|email.*template|smtp/gi, feature: 'email system', keywords: ['email', 'mail', 'notification'] },
      { pattern: /socket\.io|websocket|real-?time/gi, feature: 'real-time/WebSocket', keywords: ['realtime', 'websocket', 'live', 'chat'] },
      { pattern: /redis|cache|memcached/gi, feature: 'caching layer', keywords: ['cache', 'redis', 'fast'] },
      { pattern: /upload|multer|s3.*bucket|file.*storage/gi, feature: 'file upload', keywords: ['upload', 'file', 'image', 'attachment'] },
      { pattern: /i18n|internationali[sz]|locale|translate/gi, feature: 'internationalization', keywords: ['language', 'translate', 'i18n', 'locale'] },
      { pattern: /admin.*panel|dashboard.*admin|role.*admin/gi, feature: 'admin panel', keywords: ['admin', 'dashboard', 'panel'] },
      { pattern: /oauth|passport|google.*login|github.*login|social.*auth/gi, feature: 'OAuth/social login', keywords: ['oauth', 'google', 'github', 'social'] },
    ];

    for (const indicator of creepIndicators) {
      // Check if the feature was requested in the brief
      const requestedInBrief = indicator.keywords.some(kw => briefLower.includes(kw));
      if (requestedInBrief) continue;

      // Check if the feature appears in generated code
      for (const [file, content] of files) {
        if (this.isTestFile(file)) continue;
        const match = content.match(indicator.pattern);
        if (match) {
          findings.push({
            guard: 'scope-creep',
            severity: 'warning',
            file,
            line: this.getLineNumber(content, content.indexOf(match[0])),
            description: `Code includes '${indicator.feature}' but brief didn't request it — possible scope creep`,
            fix: `Remove if not needed. If intentional, document the decision in DECISIONS.md`,
          });
          break; // one finding per feature, not per file
        }
      }
    }

    return findings;
  }

  // ── Guard 8: Style Consistency ──────────────────────────

  private async guardStyleConsistency(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    // Check for mixed export styles
    let hasDefaultExport = false;
    let hasNamedExport = false;
    const defaultFiles: string[] = [];
    const namedFiles: string[] = [];

    for (const [file, content] of files) {
      if (this.isTestFile(file) || file.includes('index.')) continue;
      if (/export\s+default\s+/.test(content)) { hasDefaultExport = true; defaultFiles.push(file); }
      if (/export\s+(?:const|function|class|interface|type)\s+/.test(content)) { hasNamedExport = true; namedFiles.push(file); }
    }

    if (hasDefaultExport && hasNamedExport && defaultFiles.length > 2 && namedFiles.length > 2) {
      findings.push({
        guard: 'style-consistency',
        severity: 'info',
        file: 'project-wide',
        line: 0,
        description: `Mixed export styles: ${defaultFiles.length} files use default export, ${namedFiles.length} use named — pick one convention`,
        fix: 'Standardize on named exports (preferred for tree-shaking) or default exports',
      });
    }

    // Check for mixed quote styles
    let singleQuoteFiles = 0;
    let doubleQuoteFiles = 0;
    for (const [file, content] of files) {
      if (this.isTestFile(file)) continue;
      const singleCount = (content.match(/import.*from\s+'/g) ?? []).length;
      const doubleCount = (content.match(/import.*from\s+"/g) ?? []).length;
      if (singleCount > doubleCount) singleQuoteFiles++;
      else if (doubleCount > singleCount) doubleQuoteFiles++;
    }

    if (singleQuoteFiles > 2 && doubleQuoteFiles > 2) {
      findings.push({
        guard: 'style-consistency',
        severity: 'info',
        file: 'project-wide',
        line: 0,
        description: `Mixed quote styles in imports: ${singleQuoteFiles} files use single quotes, ${doubleQuoteFiles} use double`,
        fix: 'Configure prettier/eslint to enforce one quote style',
      });
    }

    return findings;
  }

  // ── Guard 9: TODO/FIXME/HACK ────────────────────────────

  private async guardTodoFixme(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    for (const [file, content] of files) {
      const regex = /\/\/\s*(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)\b[:\s]*(.*)/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const tag = match[1]!.toUpperCase();
        const desc = match[2]?.trim() ?? '';
        findings.push({
          guard: 'todo-fixme',
          severity: tag === 'FIXME' || tag === 'HACK' ? 'warning' : 'info',
          file,
          line: this.getLineNumber(content, match.index),
          description: `${tag}: ${desc || '(no description)'}`,
          fix: tag === 'FIXME' ? 'Fix the issue before shipping' :
            tag === 'HACK' ? 'Replace with proper implementation' :
            'Track in issue tracker and resolve',
        });
      }
    }

    return findings;
  }

  // ── Guard 10: Magic Numbers ─────────────────────────────

  private async guardMagicNumbers(files: Map<string, string>): Promise<GuardFinding[]> {
    const findings: GuardFinding[] = [];

    // Only flag non-obvious magic numbers in non-test files
    const regex = /(?<![\w.])(?:(?:timeout|delay|interval|limit|max|min|size|count|retries|threshold|port)\s*[:=]\s*)(\d{4,})/gi;

    for (const [file, content] of files) {
      if (this.isTestFile(file) || file.includes('config')) continue;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const num = match[1];
        // Skip common known values
        if (['3000', '4000', '8080', '8000', '1000', '5000', '60000'].includes(num!)) continue;
        findings.push({
          guard: 'magic-numbers',
          severity: 'info',
          file,
          line: this.getLineNumber(content, match.index),
          description: `Magic number ${num} — consider extracting to a named constant`,
          fix: `const MEANINGFUL_NAME = ${num}; // with comment explaining why this value`,
        });
      }
    }

    return findings;
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private async readPackageJson(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(join(this.root, 'package.json'), 'utf-8'));
    } catch { return null; }
  }

  private isTestFile(file: string): boolean {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || /__tests__\//.test(file) || /\btests?\//.test(file);
  }

  private getLineNumber(content: string, charIndex: number): number {
    let count = 0;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      count += lines[i]!.length + 1;
      if (count > charIndex) return i + 1;
    }
    return lines.length;
  }

  private async collectFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walk(this.root, files);
    return files;
  }

  private async walk(dir: string, files: string[]): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await this.walk(join(dir, entry.name), files);
      } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name).toLowerCase())) {
        files.push(relative(this.root, join(dir, entry.name)).replace(/\\/g, '/'));
      }
    }
  }
}
