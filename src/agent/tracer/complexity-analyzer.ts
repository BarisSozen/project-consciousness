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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

      if (ts.isFunctionDeclaration(node) && node.name) {
        name = node.name.text;
        body = node.body;
      } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        name = node.name.text;
        body = node.body;
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
                 (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        name = node.name.text;
        body = node.initializer.body;
      }

      if (name && body) {
        const line = sf.getLineAndCharacterOfPosition(node.pos).line + 1;
        const endLine = sf.getLineAndCharacterOfPosition(node.end).line + 1;
        const linesOfCode = endLine - line + 1;
        const cyclomatic = this.calculateCyclomatic(body);
        const cognitive = this.calculateCognitive(body);
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
        case ts.SyntaxKind.ConditionalExpression:
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
  // Cognitive Complexity (avoids double-counting else-if)
  // ═══════════════════════════════════════════════════════════

  private calculateCognitive(node: ts.Node): number {
    let complexity = 0;

    const visit = (n: ts.Node, depth: number) => {
      let addsNesting = false;

      switch (n.kind) {
        case ts.SyntaxKind.IfStatement: {
          // Only count if this is NOT an else-if (else-if is handled by parent)
          const parent = n.parent;
          const isElseIf = parent && ts.isIfStatement(parent) && parent.elseStatement === n;
          if (!isElseIf) {
            complexity += 1 + depth;
            addsNesting = true;
          } else {
            // else-if: +1 flat, no nesting increase
            complexity += 1;
          }

          // Handle the else branch
          const ifNode = n as ts.IfStatement;
          if (ifNode.elseStatement && !ts.isIfStatement(ifNode.elseStatement)) {
            // else (not else-if): +1 flat
            complexity += 1;
          }
          break;
        }
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.CatchClause:
          complexity += 1 + depth;
          addsNesting = true;
          break;
        case ts.SyntaxKind.SwitchStatement:
          complexity += 1 + depth;
          addsNesting = true;
          break;
        case ts.SyntaxKind.ConditionalExpression:
          complexity += 1 + depth;
          break;
        case ts.SyntaxKind.BinaryExpression: {
          const bin = n as ts.BinaryExpression;
          if (bin.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              bin.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            complexity += 1;
          }
          break;
        }
      }

      ts.forEachChild(n, child => visit(child, addsNesting ? depth + 1 : depth));
    };

    visit(node, 0);
    return complexity;
  }

  private rate(cyclomatic: number, cognitive: number): FunctionComplexity['rating'] {
    if (cyclomatic > CYCLOMATIC_CRIT || cognitive > COGNITIVE_CRIT) return 'critical';
    if (cyclomatic > CYCLOMATIC_WARN || cognitive > COGNITIVE_WARN) return 'warning';
    return 'ok';
  }

  private createProgram(): ts.Program | null {
    const configPath = join(this.projectRoot, 'tsconfig.json');
    if (existsSync(configPath)) {
      const configFile = ts.readConfigFile(configPath, p => readFileSync(p, 'utf-8'));
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.projectRoot);
      return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    }

    const files = this.walkDirSync(this.projectRoot);
    if (files.length === 0) return null;
    return ts.createProgram(files, { noEmit: true, allowJs: true });
  }

  private walkDirSync(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.walkDirSync(full));
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          results.push(full);
        }
      }
    } catch { /* directory not readable */ }
    return results;
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
