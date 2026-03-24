/**
 * Static Analyzer — Import/Export Graph + Dead Code + Circular Dep Tespiti
 *
 * AST-free, regex tabanlı hızlı analiz.
 * Tüm .ts/.tsx dosyalarını tarar, import/export grafiği çıkarır.
 * Kullanılmayan export'ları, kırık import'ları, döngüsel bağımlılıkları tespit eder.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, extname } from 'node:path';
import type {
  ImportEdge,
  ExportNode,
  DependencyEdge,
  WiringIssue,
} from '../../types/index.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

// ── Regex Patterns ───────────────────────────────────────────

/** import { X, Y } from './path' */
const NAMED_IMPORT = /import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;

/** import X from './path' */
const DEFAULT_IMPORT = /import\s+(?:type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/g;

/** import * as X from './path' */
const STAR_IMPORT = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

/** export { X, Y } from './path' (re-export) */
const RE_EXPORT = /export\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;

/** export default class/function/const X */
const EXPORT_DEFAULT = /export\s+default\s+(?:class|function|const|abstract\s+class)\s+(\w+)/g;

/** export class/function/const/type/interface/enum X */
const EXPORT_NAMED = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|type|interface|enum)\s+(\w+)/g;

/** export default (anonymous) */
const EXPORT_DEFAULT_ANON = /export\s+default\s+(?!class|function|const|abstract)/g;

/** import type { X } from ... (TypeScript) */
const TYPE_IMPORT = /import\s+type\s+/;

export class StaticAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Tüm kaynak dosyaları tara, import/export grafiğini çıkar
   */
  async buildGraph(): Promise<{
    imports: ImportEdge[];
    exports: ExportNode[];
    edges: DependencyEdge[];
    files: string[];
  }> {
    const files = await this.collectSourceFiles();
    const allImports: ImportEdge[] = [];
    const allExports: ExportNode[] = [];

    for (const file of files) {
      const content = await readFile(join(this.projectRoot, file), 'utf-8');
      const imports = this.extractImports(file, content);
      const exports = this.extractExports(file, content);
      allImports.push(...imports);
      allExports.push(...exports);
    }

    const edges = this.buildEdges(allImports, files);

    return { imports: allImports, exports: allExports, edges, files };
  }

  /**
   * Static wiring sorunlarını tespit et
   */
  async findIssues(): Promise<WiringIssue[]> {
    const { imports, exports, edges, files } = await this.buildGraph();
    const issues: WiringIssue[] = [];

    // 1. Dead exports — hiçbir yerde import edilmeyen export'lar
    issues.push(...this.findDeadExports(exports, imports, files));

    // 2. Missing imports — resolve edilemeyen import'lar
    issues.push(...this.findMissingImports(imports, files));

    // 3. Circular dependencies
    issues.push(...this.findCircularDeps(edges));

    // 4. Phantom dependencies — package.json'da olmayan import'lar
    issues.push(...await this.findPhantomDeps(imports));

    return issues;
  }

  // ── Import Extraction ──────────────────────────────────────

  private extractImports(file: string, content: string): ImportEdge[] {
    const imports: ImportEdge[] = [];
    const lines = content.split('\n');

    // Named imports: import { X, Y } from './path'
    for (const match of content.matchAll(NAMED_IMPORT)) {
      const symbols = match[1]!.split(',').map(s => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[0]!.trim();
      }).filter(s => s.length > 0);

      const line = this.findLineNumber(lines, match.index!);
      const isTypeOnly = TYPE_IMPORT.test(match[0]);

      imports.push({
        from: file,
        to: match[2]!,
        symbols,
        isTypeOnly,
        line,
      });
    }

    // Default imports: import X from './path'
    for (const match of content.matchAll(DEFAULT_IMPORT)) {
      // Named import regex ile overlap kontrolü
      if (match[0].includes('{')) continue;

      const line = this.findLineNumber(lines, match.index!);
      const isTypeOnly = TYPE_IMPORT.test(match[0]);

      imports.push({
        from: file,
        to: match[2]!,
        symbols: ['default'],
        isTypeOnly,
        line,
      });
    }

    // Star imports: import * as X from './path'
    for (const match of content.matchAll(STAR_IMPORT)) {
      const line = this.findLineNumber(lines, match.index!);
      imports.push({
        from: file,
        to: match[2]!,
        symbols: ['*'],
        isTypeOnly: false,
        line,
      });
    }

    return imports;
  }

  // ── Export Extraction ──────────────────────────────────────

  private extractExports(file: string, content: string): ExportNode[] {
    const exports: ExportNode[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    // Re-exports: export { X } from './path'
    for (const match of content.matchAll(RE_EXPORT)) {
      const symbols = match[1]!.split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim());
      for (const sym of symbols) {
        if (sym && !seen.has(sym)) {
          seen.add(sym);
          exports.push({ file, symbol: sym, kind: 're-export', line: this.findLineNumber(lines, match.index!) });
        }
      }
    }

    // Named exports: export class/function/const/type/interface/enum X
    for (const match of content.matchAll(EXPORT_NAMED)) {
      const sym = match[1]!;
      if (!seen.has(sym)) {
        seen.add(sym);
        const kind = this.inferExportKind(match[0]);
        exports.push({ file, symbol: sym, kind, line: this.findLineNumber(lines, match.index!) });
      }
    }

    // Default exports: export default class X
    for (const match of content.matchAll(EXPORT_DEFAULT)) {
      const sym = match[1]!;
      if (!seen.has(sym)) {
        seen.add(sym);
        exports.push({ file, symbol: sym, kind: 'default', line: this.findLineNumber(lines, match.index!) });
      }
    }

    // Anonymous default exports
    for (const match of content.matchAll(EXPORT_DEFAULT_ANON)) {
      if (!seen.has('default')) {
        seen.add('default');
        exports.push({ file, symbol: 'default', kind: 'default', line: this.findLineNumber(lines, match.index!) });
      }
    }

    return exports;
  }

  // ── Edge Building ──────────────────────────────────────────

  private buildEdges(imports: ImportEdge[], files: string[]): DependencyEdge[] {
    const edgeMap = new Map<string, DependencyEdge>();
    const fileSet = new Set(files);

    for (const imp of imports) {
      const resolved = this.resolveImportPath(imp.from, imp.to, fileSet);
      if (!resolved) continue; // external package

      const key = `${imp.from}→${resolved}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.weight++;
        for (const s of imp.symbols) {
          if (!existing.symbols.includes(s)) existing.symbols.push(s);
        }
      } else {
        edgeMap.set(key, {
          source: imp.from,
          target: resolved,
          symbols: [...imp.symbols],
          weight: 1,
        });
      }
    }

    return [...edgeMap.values()];
  }

  // ── Issue Detection ────────────────────────────────────────

  private findDeadExports(
    exports: ExportNode[],
    imports: ImportEdge[],
    files: string[]
  ): WiringIssue[] {
    const issues: WiringIssue[] = [];
    const fileSet = new Set(files);

    // Tüm import edilen symbol'leri topla (dosya bazlı)
    const importedSymbols = new Map<string, Set<string>>(); // file → symbols

    for (const imp of imports) {
      const resolved = this.resolveImportPath(imp.from, imp.to, fileSet);
      if (!resolved) continue;

      if (!importedSymbols.has(resolved)) {
        importedSymbols.set(resolved, new Set());
      }
      for (const sym of imp.symbols) {
        importedSymbols.get(resolved)!.add(sym);
        // Star import → tüm export'ları kullanılmış say
        if (sym === '*') {
          importedSymbols.get(resolved)!.add('*');
        }
      }
    }

    for (const exp of exports) {
      // Entry point dosyalarını atla (index.ts, bin/*, main)
      if (this.isEntryPoint(exp.file)) continue;
      // Type-only export'ları atla (type/interface)
      if (exp.kind === 'type' || exp.kind === 'interface') continue;

      const usedSymbols = importedSymbols.get(exp.file);
      if (!usedSymbols) {
        // Hiçbir dosya bu dosyayı import etmiyor
        issues.push({
          type: 'dead-export',
          severity: 'warning',
          file: exp.file,
          symbol: exp.symbol,
          detail: `Export '${exp.symbol}' hiçbir yerde kullanılmıyor (${exp.file}:${exp.line})`,
          suggestion: `Kullanılmıyorsa kaldır veya export'u internal yap`,
        });
      } else if (!usedSymbols.has(exp.symbol) && !usedSymbols.has('default') && !usedSymbols.has('*')) {
        issues.push({
          type: 'dead-export',
          severity: 'info',
          file: exp.file,
          symbol: exp.symbol,
          detail: `Export '${exp.symbol}' import ediliyor ama bu symbol kullanılmıyor (${exp.file}:${exp.line})`,
          suggestion: `Import listesinden ve export'tan kaldırılabilir`,
        });
      }
    }

    return issues;
  }

  private findMissingImports(imports: ImportEdge[], files: string[]): WiringIssue[] {
    const issues: WiringIssue[] = [];
    const fileSet = new Set(files);

    for (const imp of imports) {
      // Sadece relative import'ları kontrol et
      if (!imp.to.startsWith('.')) continue;

      const resolved = this.resolveImportPath(imp.from, imp.to, fileSet);
      if (!resolved) {
        issues.push({
          type: 'missing-import',
          severity: 'critical',
          file: imp.from,
          symbol: imp.symbols.join(', '),
          detail: `Import çözümlenemedi: '${imp.to}' (${imp.from}:${imp.line})`,
          suggestion: `Dosya mevcut mu? Yol doğru mu? Extension .js ekli mi?`,
        });
      }
    }

    return issues;
  }

  private findCircularDeps(edges: DependencyEdge[]): WiringIssue[] {
    const issues: WiringIssue[] = [];
    const adjList = new Map<string, string[]>();

    for (const edge of edges) {
      if (!adjList.has(edge.source)) adjList.set(edge.source, []);
      adjList.get(edge.source)!.push(edge.target);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (inStack.has(node)) {
        // Döngü bulundu — path'ten cycle'ı çıkar
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart);
        cycle.push(node);

        issues.push({
          type: 'circular-dep',
          severity: 'warning',
          file: node,
          detail: `Döngüsel bağımlılık: ${cycle.join(' → ')}`,
          suggestion: `Bağımlılık yönünü değiştir veya ortak bir interface modülüne çıkar`,
        });
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      for (const neighbor of adjList.get(node) ?? []) {
        dfs(neighbor);
      }

      path.pop();
      inStack.delete(node);
    };

    for (const node of adjList.keys()) {
      dfs(node);
    }

    return issues;
  }

  private async findPhantomDeps(imports: ImportEdge[]): Promise<WiringIssue[]> {
    const issues: WiringIssue[] = [];

    // package.json oku
    let pkgDeps: Set<string>;
    try {
      const pkg = JSON.parse(await readFile(join(this.projectRoot, 'package.json'), 'utf-8'));
      pkgDeps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
    } catch {
      return issues; // package.json yoksa kontrol etme
    }

    // External import'ları topla
    const externalImports = new Set<string>();
    for (const imp of imports) {
      if (imp.to.startsWith('.') || imp.to.startsWith('node:')) continue;
      // Scoped package: @scope/name → @scope/name
      const pkgName = imp.to.startsWith('@')
        ? imp.to.split('/').slice(0, 2).join('/')
        : imp.to.split('/')[0]!;
      externalImports.add(pkgName);
    }

    for (const pkg of externalImports) {
      // Node built-in modüllerini atla
      if (this.isNodeBuiltin(pkg)) continue;

      if (!pkgDeps.has(pkg)) {
        issues.push({
          type: 'phantom-dep',
          severity: 'critical',
          file: 'package.json',
          symbol: pkg,
          detail: `'${pkg}' import ediliyor ama package.json'da dependency olarak tanımlı değil`,
          suggestion: `npm install ${pkg} veya import'u kaldır`,
        });
      }
    }

    // Kullanılmayan dependency'ler (ters yön)
    for (const dep of pkgDeps) {
      if (dep.startsWith('@types/')) continue; // type packages
      if (!externalImports.has(dep)) {
        issues.push({
          type: 'unused-dep',
          severity: 'info',
          file: 'package.json',
          symbol: dep,
          detail: `'${dep}' package.json'da var ama hiçbir dosyada import edilmiyor`,
          suggestion: `npm uninstall ${dep} (veya dolaylı kullanılıyorsa ignore et)`,
        });
      }
    }

    return issues;
  }

  // ── Helpers ────────────────────────────────────────────────

  private async collectSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walk(this.projectRoot, files);
    return files;
  }

  private async walk(dir: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await this.walk(join(dir, entry.name), files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SOURCE_EXTS.has(ext)) {
          files.push(relative(this.projectRoot, join(dir, entry.name)).replace(/\\/g, '/'));
        }
      }
    }
  }

  /**
   * Relative import'u dosya yoluna çözümle.
   * './foo.js' → 'src/foo.ts' (TypeScript .js → .ts mapping dahil)
   */
  private resolveImportPath(fromFile: string, importPath: string, fileSet: Set<string>): string | null {
    if (!importPath.startsWith('.')) return null; // external

    const fromDir = dirname(fromFile);
    const rawResolved = join(fromDir, importPath).replace(/\\/g, '/');

    // Aday uzantılar: olduğu gibi, .ts, .tsx, .js→.ts, /index.ts
    const candidates = [
      rawResolved,
      rawResolved.replace(/\.js$/, '.ts'),
      rawResolved.replace(/\.js$/, '.tsx'),
      rawResolved.replace(/\.jsx$/, '.tsx'),
      `${rawResolved}.ts`,
      `${rawResolved}.tsx`,
      `${rawResolved}/index.ts`,
      `${rawResolved}/index.tsx`,
      `${rawResolved}/index.js`,
    ];

    for (const candidate of candidates) {
      if (fileSet.has(candidate)) return candidate;
    }

    return null;
  }

  private isEntryPoint(file: string): boolean {
    return /^(src\/)?index\.ts$/.test(file) ||
      file.includes('bin/') ||
      file.endsWith('.test.ts') ||
      file.endsWith('.spec.ts');
  }

  private isNodeBuiltin(name: string): boolean {
    const builtins = new Set([
      'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
      'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
      'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
      'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
      'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
    ]);
    return builtins.has(name);
  }

  private findLineNumber(lines: string[], charIndex: number): number {
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      count += lines[i]!.length + 1; // +1 for \n
      if (count > charIndex) return i + 1;
    }
    return lines.length;
  }

  private inferExportKind(match: string): ExportNode['kind'] {
    if (match.includes('function')) return 'function';
    if (match.includes('class')) return 'class';
    if (match.includes('type ')) return 'type';
    if (match.includes('interface')) return 'interface';
    if (match.includes('enum')) return 'enum';
    return 'const';
  }
}
