# P0 Deep Analyzers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new analyzer modules (TypeFlowAnalyzer, ComplexityAnalyzer, CoverageAnalyzer) to CSNS's tracer engine, integrated into audit report and CLI via `/deep-audit` command.

**Architecture:** Each analyzer is a standalone class in `src/agent/tracer/`, following the same pattern as `performance-budget.ts` and `security-scanner.ts`: no external deps, LLM-free, TypeScript compiler API where needed, returns a typed report. All 3 reports are added to an extended `DeepAuditReport` type. A new `/deep-audit` CLI command runs all 3 + existing audit together.

**Tech Stack:** TypeScript, TypeScript Compiler API (`typescript` package — already in devDeps), Vitest, v8 coverage JSON parsing.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/agent/tracer/type-flow-analyzer.ts` | TypeScript Checker API — type usage graph, impact chains, hot types, risk score |
| Create | `src/agent/tracer/complexity-analyzer.ts` | AST-based cyclomatic + cognitive complexity per function |
| Create | `src/agent/tracer/coverage-analyzer.ts` | Istanbul/v8 coverage JSON parse + heuristic fallback + risk zone correlation |
| Modify | `src/agent/tracer/index.ts` | Export new modules |
| Modify | `src/types/index.ts` | Add DeepAuditReport, TypeFlowReport, ComplexityReport, CoverageIntelReport types |
| Modify | `src/bin/csns.ts` | Add `/deep-audit` command + COMMANDS entry + handler |
| Create | `tests/type-flow-analyzer.test.ts` | Tests for type-flow |
| Create | `tests/complexity-analyzer.test.ts` | Tests for complexity |
| Create | `tests/coverage-analyzer.test.ts` | Tests for coverage |

---

## Task 1: TypeFlowAnalyzer — Types & Report Interface

**Files:**
- Create: `src/agent/tracer/type-flow-analyzer.ts`
- Modify: `src/types/index.ts:520+` (append new types)
- Create: `tests/type-flow-analyzer.test.ts`

### Step-by-step

- [ ] **Step 1: Add types to `src/types/index.ts`**

Append at the end of the file:

```typescript
// ============================================================
// Deep Audit Types — P0 Analyzers
// ============================================================

/** Type-Flow Analyzer: tracks type/interface usage chains and blast radius */
export interface TypeNode {
  name: string;
  file: string;
  line: number;
  kind: 'interface' | 'type' | 'enum' | 'class';
  /** Number of files that reference this type */
  usageCount: number;
  /** Files that directly import/reference this type */
  usedBy: string[];
}

export interface ImpactChain {
  /** The root type that was changed */
  source: TypeNode;
  /** All types/files that would break if source changes */
  affected: Array<{ file: string; symbol: string; depth: number }>;
  /** Total number of files in the blast radius */
  blastRadius: number;
}

export interface TypeFlowReport {
  /** All type/interface declarations found */
  typeNodes: TypeNode[];
  /** Impact chains — "if X changes, these break" */
  impactChains: ImpactChain[];
  /** Types with highest usage count (blast radius) — top 10 */
  hotTypes: TypeNode[];
  /** 0-100: higher = more type coupling risk */
  riskScore: number;
  /** Summary stats */
  summary: {
    totalTypes: number;
    totalUsages: number;
    avgUsagePerType: number;
    maxBlastRadius: number;
  };
}

/** Complexity Analyzer: cyclomatic + cognitive complexity per function */
export interface FunctionComplexity {
  name: string;
  file: string;
  line: number;
  cyclomatic: number;
  cognitive: number;
  linesOfCode: number;
  /** 'ok' | 'warning' | 'critical' based on thresholds */
  rating: 'ok' | 'warning' | 'critical';
}

export interface FileComplexity {
  file: string;
  functions: FunctionComplexity[];
  avgCyclomatic: number;
  avgCognitive: number;
  maxCyclomatic: number;
  maxCognitive: number;
  totalFunctions: number;
}

export interface ComplexityReport {
  functions: FunctionComplexity[];
  files: FileComplexity[];
  /** Top 10 most complex functions */
  hotspots: FunctionComplexity[];
  averageComplexity: { cyclomatic: number; cognitive: number };
  totalFunctions: number;
  summary: {
    ok: number;
    warning: number;
    critical: number;
  };
}

/** Coverage Analyzer: test coverage intelligence + risk zones */
export interface FunctionCoverage {
  name: string;
  file: string;
  line: number;
  covered: boolean;
  /** Line coverage percentage for this function (0-100) */
  linePercent: number;
  /** Branch coverage percentage (0-100) */
  branchPercent: number;
}

export interface FileCoverage {
  file: string;
  lines: { total: number; covered: number; percent: number };
  branches: { total: number; covered: number; percent: number };
  functions: { total: number; covered: number; percent: number };
}

export interface RiskZone {
  file: string;
  functionName: string;
  line: number;
  complexity: number;
  coveragePercent: number;
  /** Higher = more dangerous (high complexity + low coverage) */
  riskScore: number;
  reason: string;
}

export interface CoverageIntelReport {
  files: FileCoverage[];
  riskZones: RiskZone[];
  overall: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  /** Whether data came from real Istanbul/v8 JSON or heuristic */
  hasRealData: boolean;
  summary: {
    totalFiles: number;
    coveredFiles: number;
    riskZoneCount: number;
    avgLineCoverage: number;
  };
}

/** Combined deep audit report */
export interface DeepAuditReport {
  typeFlow: TypeFlowReport;
  complexity: ComplexityReport;
  coverage: CoverageIntelReport;
  /** Combined risk score (0-100) — weighted average */
  overallRisk: number;
  timestamp: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (types only, no implementation yet)

- [ ] **Step 3: Commit types**

```bash
git add src/types/index.ts
git commit -m "feat: add DeepAudit types — TypeFlow, Complexity, Coverage"
```

---

## Task 2: TypeFlowAnalyzer — Implementation

**Files:**
- Create: `src/agent/tracer/type-flow-analyzer.ts`
- Create: `tests/type-flow-analyzer.test.ts`

### Step-by-step

- [ ] **Step 1: Write the test file**

```typescript
// tests/type-flow-analyzer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeFlowAnalyzer } from '../src/agent/tracer/type-flow-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-typeflow-test-' + Date.now());

async function setupProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src', 'services'), { recursive: true });
  await mkdir(join(TEST_DIR, 'src', 'routes'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
      strict: true, outDir: 'dist', rootDir: 'src',
    },
    include: ['src'],
  }));

  // src/types.ts — the "hot" type
  await writeFile(join(TEST_DIR, 'src', 'types.ts'), `
export interface User {
  id: number;
  name: string;
  email: string;
}
export interface Todo {
  id: number;
  title: string;
  userId: number;
}
export type Role = 'admin' | 'user';
`);

  // src/services/user-service.ts — imports User
  await writeFile(join(TEST_DIR, 'src', 'services', 'user-service.ts'), `
import type { User, Role } from '../types.js';
export function getUser(id: number): User {
  return { id, name: 'Test', email: 'test@test.com' };
}
export function getRole(): Role { return 'user'; }
`);

  // src/services/todo-service.ts — imports Todo + User
  await writeFile(join(TEST_DIR, 'src', 'services', 'todo-service.ts'), `
import type { Todo, User } from '../types.js';
export function getTodos(user: User): Todo[] {
  return [{ id: 1, title: 'Test', userId: user.id }];
}
`);

  // src/routes/user-route.ts — imports User
  await writeFile(join(TEST_DIR, 'src', 'routes', 'user-route.ts'), `
import type { User } from '../types.js';
import { getUser } from '../services/user-service.js';
export function handleGetUser(id: number): User { return getUser(id); }
`);
}

describe('TypeFlowAnalyzer', () => {
  beforeEach(async () => { await setupProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('should detect all type declarations', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const names = report.typeNodes.map(t => t.name);
    expect(names).toContain('User');
    expect(names).toContain('Todo');
    expect(names).toContain('Role');
  });

  it('should identify User as hot type (used in 3 files)', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const user = report.typeNodes.find(t => t.name === 'User');
    expect(user).toBeDefined();
    expect(user!.usageCount).toBeGreaterThanOrEqual(3);
    expect(report.hotTypes[0]?.name).toBe('User');
  });

  it('should build impact chains', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const userChain = report.impactChains.find(c => c.source.name === 'User');
    expect(userChain).toBeDefined();
    expect(userChain!.blastRadius).toBeGreaterThanOrEqual(3);
  });

  it('should calculate risk score', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.riskScore).toBeLessThanOrEqual(100);
  });

  it('should provide summary stats', async () => {
    const analyzer = new TypeFlowAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.summary.totalTypes).toBeGreaterThanOrEqual(3);
    expect(report.summary.avgUsagePerType).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/type-flow-analyzer.test.ts`
Expected: FAIL — `Cannot find module '../src/agent/tracer/type-flow-analyzer.js'`

- [ ] **Step 3: Implement TypeFlowAnalyzer**

Create `src/agent/tracer/type-flow-analyzer.ts`:

```typescript
/**
 * Type-Flow Analyzer — Type Impact Analysis via TypeScript Checker API
 *
 * Tracks how types/interfaces flow through the codebase.
 * Answers: "If I change this type, what breaks?"
 *
 * Uses TypeScript's TypeChecker for 100% accurate type resolution.
 * No LLM needed — pure compiler analysis.
 */

import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import type { TypeNode, ImpactChain, TypeFlowReport } from '../../types/index.js';

export class TypeFlowAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async analyze(): Promise<TypeFlowReport> {
    const program = this.createProgram();
    if (!program) {
      return this.emptyReport();
    }

    const checker = program.getTypeChecker();
    const sourceFiles = program.getSourceFiles().filter(
      sf => !sf.isDeclarationFile &&
            !sf.fileName.includes('node_modules') &&
            !sf.fileName.includes('dist/')
    );

    // Phase 1: Collect all type declarations
    const typeNodes = this.collectTypeDeclarations(sourceFiles);

    // Phase 2: Trace usages — who imports/references each type?
    this.traceUsages(typeNodes, sourceFiles);

    // Phase 3: Build impact chains — transitive closure
    const impactChains = this.buildImpactChains(typeNodes, sourceFiles);

    // Phase 4: Rank hot types
    const hotTypes = [...typeNodes]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    // Phase 5: Risk score
    const riskScore = this.calculateRiskScore(typeNodes, impactChains);

    const totalUsages = typeNodes.reduce((sum, t) => sum + t.usageCount, 0);

    return {
      typeNodes,
      impactChains,
      hotTypes,
      riskScore,
      summary: {
        totalTypes: typeNodes.length,
        totalUsages,
        avgUsagePerType: typeNodes.length > 0 ? Math.round((totalUsages / typeNodes.length) * 10) / 10 : 0,
        maxBlastRadius: impactChains.length > 0
          ? Math.max(...impactChains.map(c => c.blastRadius))
          : 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1: Collect type declarations
  // ═══════════════════════════════════════════════════════════

  private collectTypeDeclarations(sourceFiles: readonly ts.SourceFile[]): TypeNode[] {
    const types: TypeNode[] = [];

    for (const sf of sourceFiles) {
      const relPath = relative(this.projectRoot, sf.fileName).replace(/\\/g, '/');

      const visit = (node: ts.Node) => {
        if (ts.isInterfaceDeclaration(node)) {
          types.push({
            name: node.name.text,
            file: relPath,
            line: sf.getLineAndCharacterOfPosition(node.pos).line + 1,
            kind: 'interface',
            usageCount: 0,
            usedBy: [],
          });
        } else if (ts.isTypeAliasDeclaration(node)) {
          types.push({
            name: node.name.text,
            file: relPath,
            line: sf.getLineAndCharacterOfPosition(node.pos).line + 1,
            kind: 'type',
            usageCount: 0,
            usedBy: [],
          });
        } else if (ts.isEnumDeclaration(node)) {
          types.push({
            name: node.name.text,
            file: relPath,
            line: sf.getLineAndCharacterOfPosition(node.pos).line + 1,
            kind: 'enum',
            usageCount: 0,
            usedBy: [],
          });
        } else if (ts.isClassDeclaration(node) && node.name) {
          types.push({
            name: node.name.text,
            file: relPath,
            line: sf.getLineAndCharacterOfPosition(node.pos).line + 1,
            kind: 'class',
            usageCount: 0,
            usedBy: [],
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sf);
    }

    return types;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Trace type usages across files
  // ═══════════════════════════════════════════════════════════

  private traceUsages(typeNodes: TypeNode[], sourceFiles: readonly ts.SourceFile[]): void {
    const typeMap = new Map<string, TypeNode>();
    for (const t of typeNodes) {
      typeMap.set(t.name, t);
    }

    for (const sf of sourceFiles) {
      const relPath = relative(this.projectRoot, sf.fileName).replace(/\\/g, '/');

      // Scan imports for type references
      ts.forEachChild(sf, node => {
        if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const el of node.importClause.namedBindings.elements) {
              const typeName = el.name.text;
              const typeNode = typeMap.get(typeName);
              if (typeNode && typeNode.file !== relPath) {
                if (!typeNode.usedBy.includes(relPath)) {
                  typeNode.usedBy.push(relPath);
                  typeNode.usageCount++;
                }
              }
            }
          }
        }
      });

      // Also count usages in the same file (function params, return types, etc.)
      const countLocalUsages = (node: ts.Node) => {
        if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
          const typeName = node.typeName.text;
          const typeNode = typeMap.get(typeName);
          if (typeNode && typeNode.file === relPath) {
            // Same-file usage — count the file itself
            if (!typeNode.usedBy.includes(relPath)) {
              typeNode.usedBy.push(relPath);
              typeNode.usageCount++;
            }
          }
        }
        ts.forEachChild(node, countLocalUsages);
      };

      countLocalUsages(sf);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Build impact chains (transitive closure)
  // ═══════════════════════════════════════════════════════════

  private buildImpactChains(typeNodes: TypeNode[], sourceFiles: readonly ts.SourceFile[]): ImpactChain[] {
    // Build file → imported-types map for transitive analysis
    const fileImports = new Map<string, Set<string>>();
    for (const sf of sourceFiles) {
      const relPath = relative(this.projectRoot, sf.fileName).replace(/\\/g, '/');
      const imports = new Set<string>();

      ts.forEachChild(sf, node => {
        if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const el of node.importClause.namedBindings.elements) {
              imports.add(el.name.text);
            }
          }
        }
      });

      fileImports.set(relPath, imports);
    }

    const chains: ImpactChain[] = [];

    for (const typeNode of typeNodes) {
      if (typeNode.usageCount === 0) continue;

      // BFS: find all files that transitively depend on this type
      const affected: ImpactChain['affected'] = [];
      const visited = new Set<string>();
      const queue: Array<{ file: string; depth: number }> = [];

      // Direct users
      for (const file of typeNode.usedBy) {
        if (file !== typeNode.file) {
          queue.push({ file, depth: 1 });
        }
      }

      while (queue.length > 0) {
        const { file, depth } = queue.shift()!;
        if (visited.has(file)) continue;
        visited.add(file);

        // Find what this file exports that other files import
        const fileExports = this.getFileExports(file, sourceFiles);
        for (const exp of fileExports) {
          affected.push({ file, symbol: exp, depth });
        }

        // Find files that import from this file (transitive impact)
        if (depth < 5) { // Max depth to prevent explosion
          for (const [otherFile, imports] of fileImports) {
            if (visited.has(otherFile)) continue;
            for (const exp of fileExports) {
              if (imports.has(exp)) {
                queue.push({ file: otherFile, depth: depth + 1 });
                break;
              }
            }
          }
        }
      }

      if (affected.length > 0) {
        chains.push({
          source: typeNode,
          affected,
          blastRadius: visited.size,
        });
      }
    }

    return chains.sort((a, b) => b.blastRadius - a.blastRadius);
  }

  private getFileExports(relPath: string, sourceFiles: readonly ts.SourceFile[]): string[] {
    const sf = sourceFiles.find(s =>
      relative(this.projectRoot, s.fileName).replace(/\\/g, '/') === relPath
    );
    if (!sf) return [];

    const exports: string[] = [];
    const visit = (node: ts.Node) => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      if (isExported) {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
          exports.push(node.name.text);
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) exports.push(decl.name.text);
          }
        } else if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
          exports.push(node.name.text);
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
    return exports;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5: Risk Score
  // ═══════════════════════════════════════════════════════════

  private calculateRiskScore(typeNodes: TypeNode[], chains: ImpactChain[]): number {
    if (typeNodes.length === 0) return 0;

    const maxBlast = chains.length > 0 ? Math.max(...chains.map(c => c.blastRadius)) : 0;
    const avgUsage = typeNodes.reduce((s, t) => s + t.usageCount, 0) / typeNodes.length;
    const highUsageTypes = typeNodes.filter(t => t.usageCount > 5).length;

    // Weighted formula
    const blastFactor = Math.min(maxBlast * 5, 40);           // max 40 points
    const avgUsageFactor = Math.min(avgUsage * 10, 30);       // max 30 points
    const hotTypeFactor = Math.min(highUsageTypes * 5, 30);   // max 30 points

    return Math.min(Math.round(blastFactor + avgUsageFactor + hotTypeFactor), 100);
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private createProgram(): ts.Program | null {
    const configPath = join(this.projectRoot, 'tsconfig.json');
    if (existsSync(configPath)) {
      const configFile = ts.readConfigFile(configPath, p => readFileSync(p, 'utf-8'));
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRoot);
      return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    }

    // Fallback: manual file discovery
    try {
      const { execSync } = require('node:child_process');
      const output: string = execSync(
        'find . -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*"',
        { cwd: this.projectRoot, encoding: 'utf-8', timeout: 10_000 }
      );
      const files = output.trim().split('\n').filter(Boolean).map(f => join(this.projectRoot, f));
      return ts.createProgram(files, { noEmit: true, allowJs: true });
    } catch {
      return null;
    }
  }

  private emptyReport(): TypeFlowReport {
    return {
      typeNodes: [],
      impactChains: [],
      hotTypes: [],
      riskScore: 0,
      summary: { totalTypes: 0, totalUsages: 0, avgUsagePerType: 0, maxBlastRadius: 0 },
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/type-flow-analyzer.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/tracer/type-flow-analyzer.ts tests/type-flow-analyzer.test.ts
git commit -m "feat: TypeFlowAnalyzer — type impact analysis via TS Checker API"
```

---

## Task 3: ComplexityAnalyzer — Implementation

**Files:**
- Create: `src/agent/tracer/complexity-analyzer.ts`
- Create: `tests/complexity-analyzer.test.ts`

### Step-by-step

- [ ] **Step 1: Write the test file**

```typescript
// tests/complexity-analyzer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComplexityAnalyzer } from '../src/agent/tracer/complexity-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-complexity-test-' + Date.now());

async function setupProject(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
      strict: true, outDir: 'dist', rootDir: 'src',
    },
    include: ['src'],
  }));

  // Simple function — low complexity
  await writeFile(join(TEST_DIR, 'src', 'simple.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}
`);

  // Complex function — high cyclomatic + cognitive
  await writeFile(join(TEST_DIR, 'src', 'complex.ts'), `
export function processOrder(order: any, user: any): string {
  if (!order) return 'invalid';
  if (!user) return 'no-user';

  let status = 'pending';

  if (order.type === 'express') {
    if (user.isPremium) {
      status = 'priority';
    } else if (user.orders > 10) {
      status = 'loyalty';
    } else {
      status = 'standard';
    }
  } else if (order.type === 'bulk') {
    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].quantity > 100) {
        status = 'warehouse';
        break;
      }
    }
  }

  switch (order.payment) {
    case 'card': status += '-card'; break;
    case 'bank': status += '-bank'; break;
    case 'crypto': status += '-crypto'; break;
    default: status += '-other';
  }

  return status;
}

export function simpleHelper(): boolean { return true; }
`);
}

describe('ComplexityAnalyzer', () => {
  beforeEach(async () => { await setupProject(); });
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('should rate simple functions as ok', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const addFn = report.functions.find(f => f.name === 'add');
    expect(addFn).toBeDefined();
    expect(addFn!.cyclomatic).toBe(1);
    expect(addFn!.rating).toBe('ok');
  });

  it('should detect high complexity in processOrder', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const processFn = report.functions.find(f => f.name === 'processOrder');
    expect(processFn).toBeDefined();
    expect(processFn!.cyclomatic).toBeGreaterThan(8);
    expect(processFn!.rating).toBe('warning'); // or 'critical'
  });

  it('should list hotspots sorted by complexity', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.hotspots.length).toBeGreaterThan(0);
    expect(report.hotspots[0]!.name).toBe('processOrder');
  });

  it('should provide per-file aggregates', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    const complexFile = report.files.find(f => f.file.includes('complex.ts'));
    expect(complexFile).toBeDefined();
    expect(complexFile!.totalFunctions).toBe(2);
    expect(complexFile!.maxCyclomatic).toBeGreaterThan(1);
  });

  it('should calculate summary counts', async () => {
    const analyzer = new ComplexityAnalyzer(TEST_DIR);
    const report = await analyzer.analyze();
    expect(report.totalFunctions).toBeGreaterThanOrEqual(3);
    expect(report.summary.ok).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/complexity-analyzer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ComplexityAnalyzer**

Create `src/agent/tracer/complexity-analyzer.ts`:

```typescript
/**
 * Complexity Analyzer — Cyclomatic + Cognitive Complexity
 *
 * Analyzes every function in the codebase for:
 * - Cyclomatic complexity: number of independent paths through code
 * - Cognitive complexity: how hard it is for a human to understand
 *
 * Thresholds:
 *   ok:       cyclomatic <= 10 AND cognitive <= 15
 *   warning:  cyclomatic <= 20 OR cognitive <= 30
 *   critical: above warning thresholds
 *
 * No external deps — uses TypeScript compiler API.
 */

import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  FunctionComplexity,
  FileComplexity,
  ComplexityReport,
} from '../../types/index.js';

const CYCLOMATIC_WARN = 10;
const CYCLOMATIC_CRIT = 20;
const COGNITIVE_WARN = 15;
const COGNITIVE_CRIT = 30;

export class ComplexityAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async analyze(): Promise<ComplexityReport> {
    const program = this.createProgram();
    if (!program) return this.emptyReport();

    const sourceFiles = program.getSourceFiles().filter(
      sf => !sf.isDeclarationFile &&
            !sf.fileName.includes('node_modules') &&
            !sf.fileName.includes('dist/')
    );

    const allFunctions: FunctionComplexity[] = [];

    for (const sf of sourceFiles) {
      const relPath = relative(this.projectRoot, sf.fileName).replace(/\\/g, '/');
      const functions = this.analyzeFunctions(sf, relPath);
      allFunctions.push(...functions);
    }

    // Per-file aggregates
    const fileMap = new Map<string, FunctionComplexity[]>();
    for (const fn of allFunctions) {
      const arr = fileMap.get(fn.file) ?? [];
      arr.push(fn);
      fileMap.set(fn.file, arr);
    }

    const files: FileComplexity[] = [...fileMap.entries()].map(([file, funcs]) => ({
      file,
      functions: funcs,
      avgCyclomatic: funcs.length > 0 ? Math.round(funcs.reduce((s, f) => s + f.cyclomatic, 0) / funcs.length * 10) / 10 : 0,
      avgCognitive: funcs.length > 0 ? Math.round(funcs.reduce((s, f) => s + f.cognitive, 0) / funcs.length * 10) / 10 : 0,
      maxCyclomatic: funcs.length > 0 ? Math.max(...funcs.map(f => f.cyclomatic)) : 0,
      maxCognitive: funcs.length > 0 ? Math.max(...funcs.map(f => f.cognitive)) : 0,
      totalFunctions: funcs.length,
    }));

    const hotspots = [...allFunctions]
      .sort((a, b) => (b.cyclomatic + b.cognitive) - (a.cyclomatic + a.cognitive))
      .slice(0, 10);

    const totalCyc = allFunctions.reduce((s, f) => s + f.cyclomatic, 0);
    const totalCog = allFunctions.reduce((s, f) => s + f.cognitive, 0);

    return {
      functions: allFunctions,
      files,
      hotspots,
      averageComplexity: {
        cyclomatic: allFunctions.length > 0 ? Math.round(totalCyc / allFunctions.length * 10) / 10 : 0,
        cognitive: allFunctions.length > 0 ? Math.round(totalCog / allFunctions.length * 10) / 10 : 0,
      },
      totalFunctions: allFunctions.length,
      summary: {
        ok: allFunctions.filter(f => f.rating === 'ok').length,
        warning: allFunctions.filter(f => f.rating === 'warning').length,
        critical: allFunctions.filter(f => f.rating === 'critical').length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Core: Analyze functions in a source file
  // ═══════════════════════════════════════════════════════════

  private analyzeFunctions(sf: ts.SourceFile, relPath: string): FunctionComplexity[] {
    const results: FunctionComplexity[] = [];

    const visit = (node: ts.Node) => {
      let name: string | null = null;
      let body: ts.Node | undefined;

      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        name = node.name.text;
        body = node.body;
      }
      // Method declarations
      else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        name = node.name.text;
        body = node.body;
      }
      // Arrow functions assigned to variables
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
               (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        name = node.name.text;
        body = node.initializer.body;
      }

      if (name && body) {
        const line = sf.getLineAndCharacterOfPosition(node.pos).line + 1;
        const endLine = sf.getLineAndCharacterOfPosition(node.end).line + 1;
        const linesOfCode = endLine - line + 1;

        const cyclomatic = this.calculateCyclomatic(body);
        const cognitive = this.calculateCognitive(body, 0);

        const rating = this.rate(cyclomatic, cognitive);

        results.push({ name, file: relPath, line, cyclomatic, cognitive, linesOfCode, rating });
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // Cyclomatic Complexity (McCabe)
  // ═══════════════════════════════════════════════════════════
  // Start at 1, +1 for each decision point

  private calculateCyclomatic(node: ts.Node): number {
    let complexity = 1; // base path

    const visit = (n: ts.Node) => {
      switch (n.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression: // ternary
          complexity++;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const bin = n as ts.BinaryExpression;
          if (bin.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              bin.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              bin.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
            complexity++;
          }
          break;
        }
      }
      ts.forEachChild(n, visit);
    };

    visit(node);
    return complexity;
  }

  // ═══════════════════════════════════════════════════════════
  // Cognitive Complexity
  // ═══════════════════════════════════════════════════════════
  // Like cyclomatic but penalizes nesting

  private calculateCognitive(node: ts.Node, nestingDepth: number): number {
    let complexity = 0;

    const visit = (n: ts.Node, depth: number) => {
      let increment = 0;
      let addsNesting = false;

      switch (n.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CatchClause:
          increment = 1 + depth; // base + nesting penalty
          addsNesting = true;
          break;
        case ts.SyntaxKind.SwitchStatement:
          increment = 1 + depth;
          addsNesting = true;
          break;
        case ts.SyntaxKind.ConditionalExpression:
          increment = 1 + depth;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const bin = n as ts.BinaryExpression;
          if (bin.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              bin.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            increment = 1; // no nesting penalty for logical operators
          }
          break;
        }
      }

      complexity += increment;

      // Handle 'else if' — no extra nesting increment for else
      if (ts.isIfStatement(n) && n.elseStatement) {
        if (ts.isIfStatement(n.elseStatement)) {
          // else if — add 1 but don't increase nesting
          complexity += 1;
        } else {
          // else block — add 1 with nesting
          complexity += 1 + depth;
        }
      }

      ts.forEachChild(n, child => visit(child, addsNesting ? depth + 1 : depth));
    };

    visit(node, nestingDepth);
    return complexity;
  }

  // ═══════════════════════════════════════════════════════════
  // Rating
  // ═══════════════════════════════════════════════════════════

  private rate(cyclomatic: number, cognitive: number): FunctionComplexity['rating'] {
    if (cyclomatic > CYCLOMATIC_CRIT || cognitive > COGNITIVE_CRIT) return 'critical';
    if (cyclomatic > CYCLOMATIC_WARN || cognitive > COGNITIVE_WARN) return 'warning';
    return 'ok';
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private createProgram(): ts.Program | null {
    const configPath = join(this.projectRoot, 'tsconfig.json');
    if (existsSync(configPath)) {
      const configFile = ts.readConfigFile(configPath, p => readFileSync(p, 'utf-8'));
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRoot);
      return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    }
    return null;
  }

  private emptyReport(): ComplexityReport {
    return {
      functions: [], files: [], hotspots: [],
      averageComplexity: { cyclomatic: 0, cognitive: 0 },
      totalFunctions: 0,
      summary: { ok: 0, warning: 0, critical: 0 },
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/complexity-analyzer.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/tracer/complexity-analyzer.ts tests/complexity-analyzer.test.ts
git commit -m "feat: ComplexityAnalyzer — cyclomatic + cognitive complexity scoring"
```

---

## Task 4: CoverageAnalyzer — Implementation

**Files:**
- Create: `src/agent/tracer/coverage-analyzer.ts`
- Create: `tests/coverage-analyzer.test.ts`

### Step-by-step

- [ ] **Step 1: Write the test file**

```typescript
// tests/coverage-analyzer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoverageAnalyzer } from '../src/agent/tracer/coverage-analyzer.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'csns-coverage-test-' + Date.now());

async function setupWithRealCoverage(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });
  await mkdir(join(TEST_DIR, 'coverage'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, outDir: 'dist', rootDir: 'src' },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'math.ts'), `
export function add(a: number, b: number): number { return a + b; }
export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}
`);

  await writeFile(join(TEST_DIR, 'src', 'untested.ts'), `
export function riskyFunction(input: any): string {
  if (!input) return 'empty';
  if (input.type === 'a') {
    for (let i = 0; i < input.items.length; i++) {
      if (input.items[i].valid) return 'found';
    }
  }
  return 'default';
}
`);

  // Test file exists for math.ts only
  await writeFile(join(TEST_DIR, 'tests', 'math.test.ts'), `
import { add } from '../src/math.js';
import { test, expect } from 'vitest';
test('add', () => expect(add(1, 2)).toBe(3));
`);

  // Simulated Istanbul coverage-final.json
  const coverageData = {
    [join(TEST_DIR, 'src', 'math.ts').replace(/\\/g, '/')]: {
      path: join(TEST_DIR, 'src', 'math.ts').replace(/\\/g, '/'),
      statementMap: { '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } }, '1': { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } } },
      fnMap: { '0': { name: 'add', decl: { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } }, loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 50 } } }, '1': { name: 'divide', decl: { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } }, loc: { start: { line: 3, column: 0 }, end: { line: 6, column: 1 } } } },
      branchMap: { '0': { type: 'if', loc: { start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }, locations: [{ start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }, { start: { line: 4, column: 2 }, end: { line: 4, column: 50 } }] } },
      s: { '0': 5, '1': 3 },
      f: { '0': 5, '1': 3 },
      b: { '0': [1, 2] },
    },
  };

  await writeFile(join(TEST_DIR, 'coverage', 'coverage-final.json'), JSON.stringify(coverageData, null, 2));
}

async function setupHeuristicOnly(): Promise<void> {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true });

  await writeFile(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', strict: true, outDir: 'dist', rootDir: 'src' },
    include: ['src'],
  }));

  await writeFile(join(TEST_DIR, 'src', 'tested.ts'), `export function hello() { return 'hi'; }`);
  await writeFile(join(TEST_DIR, 'src', 'untested.ts'), `export function lonely() { return 'alone'; }`);
  await writeFile(join(TEST_DIR, 'tests', 'tested.test.ts'), `import { hello } from '../src/tested.js';`);
}

describe('CoverageAnalyzer', () => {
  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  describe('with real coverage data', () => {
    beforeEach(async () => { await setupWithRealCoverage(); });

    it('should parse Istanbul coverage-final.json', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.hasRealData).toBe(true);
      expect(report.files.length).toBeGreaterThan(0);
    });

    it('should report per-file coverage', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      const mathFile = report.files.find(f => f.file.includes('math.ts'));
      expect(mathFile).toBeDefined();
      expect(mathFile!.functions.covered).toBeGreaterThan(0);
    });
  });

  describe('heuristic fallback (no coverage JSON)', () => {
    beforeEach(async () => { await setupHeuristicOnly(); });

    it('should detect tested files via test file matching', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      expect(report.hasRealData).toBe(false);
      expect(report.summary.coveredFiles).toBeGreaterThanOrEqual(1);
    });

    it('should detect untested source files', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      const untestedFile = report.files.find(f => f.file.includes('untested.ts'));
      expect(untestedFile).toBeDefined();
      expect(untestedFile!.functions.percent).toBe(0);
    });
  });

  describe('risk zones', () => {
    beforeEach(async () => { await setupWithRealCoverage(); });

    it('should flag high-complexity + low-coverage as risk zones', async () => {
      const analyzer = new CoverageAnalyzer(TEST_DIR);
      const report = await analyzer.analyze();
      // untested.ts has no coverage → should be a risk zone
      // (only if complexity data is available)
      expect(report.riskZones).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/coverage-analyzer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoverageAnalyzer**

Create `src/agent/tracer/coverage-analyzer.ts`:

```typescript
/**
 * Coverage Analyzer — Test Coverage Intelligence + Risk Zones
 *
 * Two modes:
 * 1. Real: Parse Istanbul/v8 coverage-final.json for actual line/branch/function data
 * 2. Heuristic: Match source files to test files (foo.ts ↔ foo.test.ts)
 *
 * Cross-references with complexity data to find "ticking bombs":
 * high complexity + low coverage = high risk zone.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, basename, extname } from 'node:path';
import type {
  FileCoverage,
  RiskZone,
  CoverageIntelReport,
} from '../../types/index.js';
import { ComplexityAnalyzer } from './complexity-analyzer.js';

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  fnMap: Record<string, { name: string; decl: { start: { line: number } }; loc: { start: { line: number }; end: { line: number } } }>;
  branchMap: Record<string, { locations: Array<{ start: { line: number } }> }>;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
}

export class CoverageAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async analyze(): Promise<CoverageIntelReport> {
    // Try real coverage first
    const realData = await this.tryRealCoverage();
    if (realData) {
      const riskZones = await this.calculateRiskZones(realData.files);
      return { ...realData, riskZones };
    }

    // Fallback to heuristic
    const heuristic = await this.heuristicCoverage();
    const riskZones = await this.calculateRiskZones(heuristic.files);
    return { ...heuristic, riskZones };
  }

  // ═══════════════════════════════════════════════════════════
  // Mode 1: Real Istanbul/v8 coverage data
  // ═══════════════════════════════════════════════════════════

  private async tryRealCoverage(): Promise<Omit<CoverageIntelReport, 'riskZones'> | null> {
    const coveragePaths = [
      join(this.projectRoot, 'coverage', 'coverage-final.json'),
      join(this.projectRoot, '.nyc_output', 'coverage-final.json'),
      join(this.projectRoot, 'coverage', 'coverage-summary.json'),
    ];

    for (const coveragePath of coveragePaths) {
      try {
        const raw = await readFile(coveragePath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, IstanbulFileCoverage>;
        return this.parseIstanbulData(data);
      } catch {
        continue;
      }
    }

    return null;
  }

  private parseIstanbulData(data: Record<string, IstanbulFileCoverage>): Omit<CoverageIntelReport, 'riskZones'> {
    const files: FileCoverage[] = [];

    let totalLines = 0, coveredLines = 0;
    let totalBranches = 0, coveredBranches = 0;
    let totalFunctions = 0, coveredFunctions = 0;
    let totalStatements = 0, coveredStatements = 0;

    for (const [filePath, fileCov] of Object.entries(data)) {
      const relPath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      // Statements
      const stmtTotal = Object.keys(fileCov.s).length;
      const stmtCovered = Object.values(fileCov.s).filter(v => v > 0).length;

      // Functions
      const fnTotal = Object.keys(fileCov.f).length;
      const fnCovered = Object.values(fileCov.f).filter(v => v > 0).length;

      // Branches
      const branchTotal = Object.values(fileCov.b).reduce((s, arr) => s + arr.length, 0);
      const branchCovered = Object.values(fileCov.b).reduce((s, arr) => s + arr.filter(v => v > 0).length, 0);

      // Lines (approximate from statement map)
      const lineTotal = stmtTotal;
      const lineCovered = stmtCovered;

      files.push({
        file: relPath,
        lines: { total: lineTotal, covered: lineCovered, percent: lineTotal > 0 ? Math.round(lineCovered / lineTotal * 100) : 0 },
        branches: { total: branchTotal, covered: branchCovered, percent: branchTotal > 0 ? Math.round(branchCovered / branchTotal * 100) : 0 },
        functions: { total: fnTotal, covered: fnCovered, percent: fnTotal > 0 ? Math.round(fnCovered / fnTotal * 100) : 0 },
      });

      totalLines += lineTotal;
      coveredLines += lineCovered;
      totalBranches += branchTotal;
      coveredBranches += branchCovered;
      totalFunctions += fnTotal;
      coveredFunctions += fnCovered;
      totalStatements += stmtTotal;
      coveredStatements += stmtCovered;
    }

    return {
      files,
      overall: {
        lines: totalLines > 0 ? Math.round(coveredLines / totalLines * 100) : 0,
        branches: totalBranches > 0 ? Math.round(coveredBranches / totalBranches * 100) : 0,
        functions: totalFunctions > 0 ? Math.round(coveredFunctions / totalFunctions * 100) : 0,
        statements: totalStatements > 0 ? Math.round(coveredStatements / totalStatements * 100) : 0,
      },
      hasRealData: true,
      summary: {
        totalFiles: files.length,
        coveredFiles: files.filter(f => f.lines.percent > 0).length,
        riskZoneCount: 0, // filled later
        avgLineCoverage: files.length > 0 ? Math.round(files.reduce((s, f) => s + f.lines.percent, 0) / files.length) : 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Mode 2: Heuristic — match source ↔ test files
  // ═══════════════════════════════════════════════════════════

  private async heuristicCoverage(): Promise<Omit<CoverageIntelReport, 'riskZones'>> {
    const sourceFiles = await this.findFiles('src');
    const testFiles = await this.findFiles('tests');
    const altTestFiles = await this.findFiles('test');
    const allTestFiles = [...testFiles, ...altTestFiles];

    // Also check for co-located test files (*.test.ts in src/)
    const colocatedTests = sourceFiles.filter(f =>
      f.endsWith('.test.ts') || f.endsWith('.spec.ts') ||
      f.endsWith('.test.tsx') || f.endsWith('.spec.tsx')
    );
    allTestFiles.push(...colocatedTests);

    // Build test file base names
    const testBases = new Set(
      allTestFiles.map(f => {
        const base = basename(f);
        return base.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, '');
      })
    );

    const files: FileCoverage[] = [];
    const srcOnly = sourceFiles.filter(f =>
      !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') &&
      !f.endsWith('.d.ts')
    );

    let coveredCount = 0;

    for (const file of srcOnly) {
      const base = basename(file).replace(/\.(ts|tsx|js|jsx)$/, '');
      const hasCoverage = testBases.has(base);

      if (hasCoverage) coveredCount++;

      files.push({
        file,
        lines: { total: 0, covered: 0, percent: hasCoverage ? 50 : 0 },    // heuristic: 50% assumed if test exists
        branches: { total: 0, covered: 0, percent: hasCoverage ? 30 : 0 },
        functions: { total: 0, covered: 0, percent: hasCoverage ? 50 : 0 },
      });
    }

    return {
      files,
      overall: {
        lines: srcOnly.length > 0 ? Math.round(coveredCount / srcOnly.length * 50) : 0,
        branches: 0,
        functions: srcOnly.length > 0 ? Math.round(coveredCount / srcOnly.length * 50) : 0,
        statements: 0,
      },
      hasRealData: false,
      summary: {
        totalFiles: srcOnly.length,
        coveredFiles: coveredCount,
        riskZoneCount: 0,
        avgLineCoverage: srcOnly.length > 0 ? Math.round(coveredCount / srcOnly.length * 50) : 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Risk Zones: cross-reference with complexity
  // ═══════════════════════════════════════════════════════════

  private async calculateRiskZones(files: FileCoverage[]): Promise<RiskZone[]> {
    const complexityAnalyzer = new ComplexityAnalyzer(this.projectRoot);

    let complexityReport;
    try {
      complexityReport = await complexityAnalyzer.analyze();
    } catch {
      return []; // If complexity analysis fails, no risk zones
    }

    const riskZones: RiskZone[] = [];

    for (const fn of complexityReport.functions) {
      if (fn.rating === 'ok') continue; // Only flag complex functions

      const fileCov = files.find(f => f.file === fn.file || fn.file.endsWith(f.file) || f.file.endsWith(fn.file));
      const coveragePercent = fileCov?.lines.percent ?? 0;

      // Risk = complexity * (1 - coverage/100)
      const riskScore = Math.round((fn.cyclomatic + fn.cognitive) * (1 - coveragePercent / 100));

      if (riskScore > 5) {
        riskZones.push({
          file: fn.file,
          functionName: fn.name,
          line: fn.line,
          complexity: fn.cyclomatic + fn.cognitive,
          coveragePercent,
          riskScore,
          reason: `Complexity ${fn.cyclomatic}cc/${fn.cognitive}cog with ${coveragePercent}% coverage`,
        });
      }
    }

    return riskZones.sort((a, b) => b.riskScore - a.riskScore);
  }

  // ═══════════════════════════════════════════════════════════
  // File discovery
  // ═══════════════════════════════════════════════════════════

  private async findFiles(dir: string): Promise<string[]> {
    const fullDir = join(this.projectRoot, dir);
    const results: string[] = [];

    try {
      await this.walkDir(fullDir, results);
    } catch {
      // Directory doesn't exist
    }

    return results.map(f => relative(this.projectRoot, f).replace(/\\/g, '/'));
  }

  private async walkDir(dir: string, results: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        await this.walkDir(full, results);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/coverage-analyzer.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/tracer/coverage-analyzer.ts tests/coverage-analyzer.test.ts
git commit -m "feat: CoverageAnalyzer — Istanbul parse + heuristic fallback + risk zones"
```

---

## Task 5: Wire into tracer/index.ts exports

**Files:**
- Modify: `src/agent/tracer/index.ts`

- [ ] **Step 1: Add exports**

Append to `src/agent/tracer/index.ts`:

```typescript
export { TypeFlowAnalyzer } from './type-flow-analyzer.js';
export { ComplexityAnalyzer } from './complexity-analyzer.js';
export { CoverageAnalyzer } from './coverage-analyzer.js';
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (existing + 15 new)

- [ ] **Step 4: Commit**

```bash
git add src/agent/tracer/index.ts
git commit -m "feat: export P0 analyzers from tracer module"
```

---

## Task 6: `/deep-audit` CLI command

**Files:**
- Modify: `src/bin/csns.ts`

- [ ] **Step 1: Add command handler**

Add `cmdDeepAudit` function after `cmdReview` (around line 297):

```typescript
async function cmdDeepAudit(): Promise<void> {
  console.log('  🔬 Running deep audit (type-flow + complexity + coverage)...\n');

  const { TypeFlowAnalyzer } = await import('../agent/tracer/type-flow-analyzer.js');
  const { ComplexityAnalyzer } = await import('../agent/tracer/complexity-analyzer.js');
  const { CoverageAnalyzer } = await import('../agent/tracer/coverage-analyzer.js');

  // Run all 3 in parallel
  const [typeFlow, complexity, coverage] = await Promise.all([
    new TypeFlowAnalyzer(PROJECT_ROOT).analyze(),
    new ComplexityAnalyzer(PROJECT_ROOT).analyze(),
    new CoverageAnalyzer(PROJECT_ROOT).analyze(),
  ]);

  // ── Type Flow ──
  console.log('  ═══════════════════════════════════════════');
  console.log('  🔀 TYPE FLOW ANALYSIS');
  console.log('  ═══════════════════════════════════════════\n');
  console.log(`  Types found: ${typeFlow.summary.totalTypes}`);
  console.log(`  Avg usage/type: ${typeFlow.summary.avgUsagePerType}`);
  console.log(`  Max blast radius: ${typeFlow.summary.maxBlastRadius}`);
  console.log(`  Risk score: ${typeFlow.riskScore}/100\n`);

  if (typeFlow.hotTypes.length > 0) {
    console.log('  🔥 Hot Types (highest blast radius):');
    for (const t of typeFlow.hotTypes.slice(0, 5)) {
      console.log(`     ${t.name} — used in ${t.usageCount} files (${t.file})`);
    }
  }

  // ── Complexity ──
  console.log('\n  ═══════════════════════════════════════════');
  console.log('  🧠 COMPLEXITY ANALYSIS');
  console.log('  ═══════════════════════════════════════════\n');
  console.log(`  Functions analyzed: ${complexity.totalFunctions}`);
  console.log(`  Avg cyclomatic: ${complexity.averageComplexity.cyclomatic}`);
  console.log(`  Avg cognitive: ${complexity.averageComplexity.cognitive}`);
  console.log(`  ✅ OK: ${complexity.summary.ok}  ⚠️ Warning: ${complexity.summary.warning}  🚨 Critical: ${complexity.summary.critical}\n`);

  if (complexity.hotspots.length > 0) {
    console.log('  🔥 Complexity Hotspots:');
    for (const h of complexity.hotspots.slice(0, 5)) {
      const icon = h.rating === 'critical' ? '🚨' : h.rating === 'warning' ? '⚠️' : '✅';
      console.log(`     ${icon} ${h.name} — cc:${h.cyclomatic} cog:${h.cognitive} (${h.file}:${h.line})`);
    }
  }

  // ── Coverage ──
  console.log('\n  ═══════════════════════════════════════════');
  console.log('  📊 COVERAGE INTELLIGENCE');
  console.log('  ═══════════════════════════════════════════\n');
  console.log(`  Data source: ${coverage.hasRealData ? 'Istanbul/v8 (real)' : 'Heuristic (estimated)'}`);
  console.log(`  Files: ${coverage.summary.coveredFiles}/${coverage.summary.totalFiles} have tests`);
  console.log(`  Line coverage: ${coverage.overall.lines}%`);
  console.log(`  Function coverage: ${coverage.overall.functions}%\n`);

  if (coverage.riskZones.length > 0) {
    console.log('  💣 Risk Zones (high complexity + low coverage):');
    for (const r of coverage.riskZones.slice(0, 5)) {
      console.log(`     🚨 ${r.functionName} — risk:${r.riskScore} (${r.reason}) [${r.file}:${r.line}]`);
    }
  }

  // ── Combined ──
  const overallRisk = Math.round(
    (typeFlow.riskScore * 0.3 +
     (complexity.summary.critical > 0 ? 80 : complexity.summary.warning > 3 ? 50 : 20) * 0.3 +
     (100 - coverage.overall.lines) * 0.4)
  );

  console.log('\n  ═══════════════════════════════════════════');
  console.log(`  🎯 OVERALL RISK: ${overallRisk}/100`);
  console.log('  ═══════════════════════════════════════════\n');
}
```

- [ ] **Step 2: Register command in COMMANDS array**

Add to the `COMMANDS` array (around line 431), after the `/trace` entry:

```typescript
  { cmd: '/deep-audit', label: '🔬 /deep-audit',    description: 'Type-flow + complexity + coverage', group: 'Analyze' },
```

- [ ] **Step 3: Add command dispatch in REPL**

In the `rl.on('line')` handler (around line 553), add after the `/trace` check:

```typescript
      } else if (input === '/deep-audit') {
        await cmdDeepAudit();
```

- [ ] **Step 4: Add to non-interactive mode**

In `nonInteractive` function, add a case (around line 604):

```typescript
    case 'deep-audit':
      await cmdDeepAudit();
      break;
```

- [ ] **Step 5: Update help text and menu**

In `printInteractiveMenu`, add under Analyze section:

```typescript
   │    /deep-audit      Type + complexity +  │
   │                     coverage analysis     │
```

In `printHelp`, add:

```typescript
    /deep-audit     Type-flow + complexity + coverage intelligence
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/bin/csns.ts
git commit -m "feat: /deep-audit CLI command — type-flow + complexity + coverage"
```

---

## Task 7: Integration Test — Run deep-audit on CSNS itself

**Files:** No new files — manual verification

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: Run deep-audit on CSNS itself**

Run: `npx tsx src/bin/csns.ts deep-audit`
Expected: Full report showing CSNS's own type-flow, complexity hotspots, and coverage stats

- [ ] **Step 3: Verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS (existing 217 + new 15 = ~232)

- [ ] **Step 4: Final commit — bump version**

Update `package.json` version to `0.9.11`, then:

```bash
git add -A
git commit -m "feat: P0 deep analyzers — type-flow, complexity, coverage intelligence

Three new LLM-free analyzer modules:
- TypeFlowAnalyzer: type impact analysis via TS Checker API
- ComplexityAnalyzer: cyclomatic + cognitive complexity scoring
- CoverageAnalyzer: Istanbul/v8 + heuristic coverage + risk zones

New CLI command: /deep-audit"
```
