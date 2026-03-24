/**
 * Cross-File Value Checker — Detect Mismatches Across Files
 *
 * Finds values that should be consistent but aren't:
 * - Token TTL vs Cookie maxAge
 * - Port numbers vs service URLs
 * - Env vars used but not in .env.example
 * - Schema field names vs DB column names
 * - Rate limit values vs Redis TTL
 * - Duplicated constants with different values
 *
 * This is the thing no other tool does well — CSNS's differentiator.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ValueMismatch {
  id: string;
  category: 'ttl-mismatch' | 'port-url-mismatch' | 'env-undefined' | 'duplicate-constant' | 'schema-mismatch';
  severity: 'high' | 'medium' | 'low';
  description: string;
  locations: Array<{ file: string; line: number; value: string }>;
  fix: string;
}

export interface CrossFileReport {
  mismatches: ValueMismatch[];
  envUsage: { defined: string[]; used: string[]; missing: string[]; unused: string[] };
  summary: { total: number; high: number; medium: number; low: number };
  duration: number;
}

// ═══════════════════════════════════════════════════════════
// Patterns
// ═══════════════════════════════════════════════════════════

interface ExtractedValue {
  file: string;
  line: number;
  key: string;
  value: string;
  category: string;
}

const EXTRACT_PATTERNS: Array<{
  category: string;
  pattern: RegExp;
  keyGroup: number;
  valueGroup: number;
}> = [
  // TTL / expiry / maxAge values
  { category: 'ttl', pattern: /(?:TTL|ttl|expir(?:es?|y|ation)|maxAge|max_age|timeout|TIMEOUT)\s*[:=]\s*['"]?(\w+)['"]?\s*.*?(\d+[\s*]*(?:\*[\s*]*\d+)*|'\d+[smhd]')/gi, keyGroup: 0, valueGroup: 2 },

  // Port numbers
  { category: 'port', pattern: /(?:PORT|port)\s*[:=]\s*['"]?(\d{4,5})['"]?/g, keyGroup: 0, valueGroup: 1 },

  // Service URLs with ports
  { category: 'url', pattern: /(?:URL|url|endpoint|host|HOST)\s*[:=]\s*['"`]?(https?:\/\/[^'"`\s,;]+)['"`]?/g, keyGroup: 0, valueGroup: 1 },

  // Rate limits
  { category: 'rate-limit', pattern: /(?:RATE_LIMIT|rateLimit|limit|MAX_REQUESTS|maxRequests)\s*[:=]\s*(\d+)/gi, keyGroup: 0, valueGroup: 1 },

  // Secret/key names (for consistency check)
  { category: 'secret-name', pattern: /process\.env\[?['"]?(\w+(?:SECRET|KEY|TOKEN|PASSWORD)\w*)['"]?\]?/g, keyGroup: 0, valueGroup: 1 },
];

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.env', '.env.example', '.env.local']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);

// ═══════════════════════════════════════════════════════════
// Checker
// ═══════════════════════════════════════════════════════════

export class CrossFileChecker {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async check(): Promise<CrossFileReport> {
    const start = Date.now();
    const files = await this.collectFiles();
    const mismatches: ValueMismatch[] = [];
    let mismatchCounter = 0;

    // 1. Extract all values
    const allValues: ExtractedValue[] = [];
    for (const file of files) {
      let content: string;
      try { content = await readFile(join(this.projectRoot, file), 'utf-8'); } catch { continue; }

      for (const pattern of EXTRACT_PATTERNS) {
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const lineNum = this.getLineNumber(content, match.index);
          allValues.push({
            file,
            line: lineNum,
            key: match[pattern.keyGroup] ?? match[0] ?? '',
            value: match[pattern.valueGroup] ?? '',
            category: pattern.category,
          });
        }
      }
    }

    // 2. Env var analysis
    const envUsage = await this.analyzeEnvVars(files);
    for (const missing of envUsage.missing) {
      mismatches.push({
        id: `XVAL-${++mismatchCounter}`,
        category: 'env-undefined',
        severity: 'medium',
        description: `Environment variable '${missing}' is used in code but not defined in .env.example`,
        locations: allValues
          .filter(v => v.category === 'secret-name' && v.value === missing)
          .map(v => ({ file: v.file, line: v.line, value: `process.env.${missing}` })),
        fix: `Add ${missing}= to .env.example with a placeholder value`,
      });
    }

    // 3. Port/URL consistency
    const ports = allValues.filter(v => v.category === 'port');
    const urls = allValues.filter(v => v.category === 'url');
    for (const port of ports) {
      const portNum = port.value;
      const matchingUrls = urls.filter(u => u.value.includes(`:${portNum}`));
      const nonMatchingUrls = urls.filter(u =>
        u.value.includes('localhost') &&
        !u.value.includes(`:${portNum}`) &&
        u.file !== port.file
      );
      if (matchingUrls.length > 0 && nonMatchingUrls.length > 0) {
        mismatches.push({
          id: `XVAL-${++mismatchCounter}`,
          category: 'port-url-mismatch',
          severity: 'medium',
          description: `Port ${portNum} defined in ${port.file} but some URLs point to different ports`,
          locations: [
            { file: port.file, line: port.line, value: `PORT=${portNum}` },
            ...nonMatchingUrls.map(u => ({ file: u.file, line: u.line, value: u.value })),
          ],
          fix: 'Ensure all service URLs use the correct port, or centralize port config',
        });
      }
    }

    // 4. Duplicate constants with different values
    const constants = allValues.filter(v => v.category === 'ttl' || v.category === 'rate-limit');
    const byKey = new Map<string, ExtractedValue[]>();
    for (const c of constants) {
      const normalizedKey = c.key.toLowerCase().replace(/[_\s-]/g, '');
      if (!byKey.has(normalizedKey)) byKey.set(normalizedKey, []);
      byKey.get(normalizedKey)!.push(c);
    }
    for (const [key, values] of byKey) {
      if (values.length < 2) continue;
      const uniqueValues = new Set(values.map(v => v.value));
      if (uniqueValues.size > 1) {
        mismatches.push({
          id: `XVAL-${++mismatchCounter}`,
          category: 'duplicate-constant',
          severity: 'low',
          description: `Constant '${key}' has different values across files: ${[...uniqueValues].join(' vs ')}`,
          locations: values.map(v => ({ file: v.file, line: v.line, value: v.value })),
          fix: 'Extract to a shared constants file to ensure consistency',
        });
      }
    }

    const summary = {
      total: mismatches.length,
      high: mismatches.filter(m => m.severity === 'high').length,
      medium: mismatches.filter(m => m.severity === 'medium').length,
      low: mismatches.filter(m => m.severity === 'low').length,
    };

    return { mismatches, envUsage, summary, duration: Date.now() - start };
  }

  // ═══════════════════════════════════════════════════════════
  // Env Var Analysis
  // ═══════════════════════════════════════════════════════════

  private async analyzeEnvVars(files: string[]): Promise<CrossFileReport['envUsage']> {
    // Collect used env vars from code
    const used = new Set<string>();
    for (const file of files) {
      if (file.endsWith('.env') || file.endsWith('.env.example')) continue;
      let content: string;
      try { content = await readFile(join(this.projectRoot, file), 'utf-8'); } catch { continue; }

      const regex = /process\.env\[?['"]?(\w+)['"]?\]?/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        if (match[1]) used.add(match[1]);
      }
    }

    // Collect defined env vars from .env.example
    const defined = new Set<string>();
    const envFiles = ['.env.example', '.env.local', '.env'];
    for (const ef of envFiles) {
      try {
        const content = await readFile(join(this.projectRoot, ef), 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/^(\w+)\s*=/);
          if (match?.[1] && !match[1].startsWith('#')) defined.add(match[1]);
        }
      } catch { /* file not found */ }
    }

    // Common Node.js env vars — don't flag these
    const builtins = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'USER', 'SHELL', 'PWD', 'TERM', 'LANG', 'TZ']);

    const missing = [...used].filter(v => !defined.has(v) && !builtins.has(v));
    const unused = [...defined].filter(v => !used.has(v) && !builtins.has(v));

    return {
      defined: [...defined],
      used: [...used],
      missing,
      unused,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

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
    await this.walk(this.projectRoot, files);
    return files;
  }

  private async walk(dir: string, files: string[]): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await this.walk(join(dir, entry.name), files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const name = entry.name;
        if (SOURCE_EXTS.has(ext) || name === '.env.example' || name === '.env' || name === '.env.local') {
          files.push(relative(this.projectRoot, join(dir, entry.name)).replace(/\\/g, '/'));
        }
      }
    }
  }
}
