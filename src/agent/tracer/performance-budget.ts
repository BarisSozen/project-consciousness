/**
 * Performance Budget — N+1 Query, Bundle Size, Memory Leak Pattern Detection
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export interface PerfFinding {
  rule: string;
  severity: 'high' | 'medium' | 'low';
  file: string;
  line: number;
  description: string;
  fix: string;
}

export interface PerfReport {
  findings: PerfFinding[];
  summary: { total: number; high: number; medium: number; low: number };
}

const PERF_RULES: Array<{
  id: string;
  pattern: RegExp;
  severity: PerfFinding['severity'];
  description: string;
  fix: string;
  antiPattern?: RegExp;
}> = [
  // N+1 queries
  {
    id: 'PERF-01',
    pattern: /for\s*\([^)]*\)\s*{[^}]*(?:await\s+)?(?:query|findOne|findById|get)\s*\(/gs,
    severity: 'high',
    description: 'Possible N+1 query — database call inside a loop',
    fix: 'Use batch query (findMany/IN clause) or DataLoader to batch requests',
  },
  // Missing index hints
  {
    id: 'PERF-02',
    pattern: /WHERE[^;]*(?:LIKE\s+['"]\%|(?:!=|<>)\s*NULL|NOT\s+IN\s*\()/gi,
    severity: 'medium',
    description: 'SQL pattern that may bypass indexes (LIKE with leading %, NOT IN, != NULL)',
    fix: 'Use IS NOT NULL instead of != NULL. Consider full-text search instead of LIKE %x%',
  },
  // Unbounded queries
  {
    id: 'PERF-03',
    pattern: /(?:SELECT\s+\*|findMany|find\(\s*\{?\s*\}?\s*\))\s*(?!.*(?:LIMIT|limit|take|\.slice))/gi,
    severity: 'medium',
    description: 'Unbounded query — SELECT * or findMany without LIMIT',
    fix: 'Add LIMIT/take to prevent loading entire table into memory',
  },
  // Missing async in route handlers
  {
    id: 'PERF-04',
    pattern: /\.(?:get|post|put|delete)\s*\(\s*['"][^'"]+['"]\s*,\s*(?!async)\s*\(/g,
    severity: 'low',
    description: 'Sync route handler — if it does I/O, it should be async',
    fix: 'Add async if the handler performs database/file/network operations',
  },
  // console.log in production code
  {
    id: 'PERF-05',
    pattern: /console\.log\s*\(/g,
    severity: 'low',
    description: 'console.log in source code — use a proper logger for production',
    fix: 'Replace with structured logger (pino, winston) that respects log levels',
    antiPattern: /\/\/.*console|test|spec|\.test\.|\.spec\./,
  },
  // Sync file operations
  {
    id: 'PERF-06',
    pattern: /(?:readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync)\s*\(/g,
    severity: 'medium',
    description: 'Synchronous file operation — blocks event loop',
    fix: 'Use async version (readFile, writeFile, etc.) with await',
    antiPattern: /config|startup|init|bootstrap|bin\//,
  },
  // JSON.parse without size check
  {
    id: 'PERF-07',
    pattern: /JSON\.parse\s*\(\s*(?:req\.body|body|data|payload|chunk)/g,
    severity: 'medium',
    description: 'JSON.parse on request body without size limit — DoS risk',
    fix: 'Use express.json({ limit: "1mb" }) or validate size before parsing',
  },
  // Missing connection pooling hint
  {
    id: 'PERF-08',
    pattern: /new\s+(?:Client|Pool|Connection)\s*\(\s*\)/g,
    severity: 'low',
    description: 'Database client created without explicit pool configuration',
    fix: 'Configure connection pool (max, idleTimeout) for production workloads',
  },
];

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

export class PerformanceBudget {
  private root: string;

  constructor(projectRoot: string) {
    this.root = projectRoot;
  }

  async check(): Promise<PerfReport> {
    const files = await this.collectFiles();
    const findings: PerfFinding[] = [];

    for (const file of files) {
      if (/\.(test|spec)\.(ts|tsx|js)$/.test(file) || /__tests__\//.test(file)) continue;
      let content: string;
      try { content = await readFile(join(this.root, file), 'utf-8'); } catch { continue; }

      for (const rule of PERF_RULES) {
        if (rule.antiPattern && rule.antiPattern.test(file)) continue;
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          if (rule.antiPattern && rule.antiPattern.test(content.slice(Math.max(0, match.index - 50), match.index + 50))) continue;
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: this.getLineNumber(content, match.index),
            description: rule.description,
            fix: rule.fix,
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = findings.filter(f => {
      const key = `${f.rule}:${f.file}:${f.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      findings: deduped,
      summary: {
        total: deduped.length,
        high: deduped.filter(f => f.severity === 'high').length,
        medium: deduped.filter(f => f.severity === 'medium').length,
        low: deduped.filter(f => f.severity === 'low').length,
      },
    };
  }

  private getLineNumber(content: string, idx: number): number {
    const lines = content.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      count += lines[i]!.length + 1;
      if (count > idx) return i + 1;
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
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await this.walk(join(dir, e.name), files);
      } else if (e.isFile() && SOURCE_EXTS.has(extname(e.name).toLowerCase())) {
        files.push(relative(this.root, join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  }
}
