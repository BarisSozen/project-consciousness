/**
 * Convention Detector — Extract Project Coding Conventions
 *
 * Scans a codebase and auto-detects:
 * - Naming conventions (camelCase, PascalCase, snake_case, kebab-case)
 * - Import style (named, default, barrel)
 * - Error handling pattern (throw, Result, callback)
 * - Validation library (Zod, Joi, none)
 * - Async pattern (async-await, promise-then, callback)
 * - Export style (named, default)
 * - Indentation, semicolons, quotes
 * - Test framework & pattern
 *
 * Outputs a `promptSnippet` for injection into agent context.
 * No LLM needed — pure heuristic + AST analysis.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import type {
  ProjectConventions,
  ConventionViolation,
  ConventionReport,
  NamingConvention,
  ImportStyle,
  ErrorStrategy,
  AsyncPattern,
  ExportStyle,
  TestFramework,
} from '../../types/index.js';

export class ConventionDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async detect(): Promise<ConventionReport> {
    const files = this.findSourceFiles();
    if (files.length === 0) {
      return this.emptyReport();
    }

    const contents = files.map(f => ({
      path: f,
      relPath: relative(this.projectRoot, f).replace(/\\/g, '/'),
      content: readFileSync(f, 'utf-8'),
    }));

    const conventions = this.analyzeConventions(contents);
    const violations = this.findViolations(contents, conventions);
    const promptSnippet = this.generatePromptSnippet(conventions);

    return {
      conventions,
      violations,
      promptSnippet,
      summary: {
        totalFiles: files.length,
        violationCount: violations.length,
        autoFixable: violations.filter(v => v.autoFixable).length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Convention Analysis
  // ═══════════════════════════════════════════════════════════

  private analyzeConventions(files: Array<{ path: string; relPath: string; content: string }>): ProjectConventions {
    const srcFiles = files.filter(f => !f.relPath.includes('.test.') && !f.relPath.includes('.spec.'));
    const testFiles = files.filter(f => f.relPath.includes('.test.') || f.relPath.includes('.spec.'));

    return {
      fileNaming: this.detectFileNaming(srcFiles.map(f => f.relPath)),
      variableNaming: this.detectVariableNaming(srcFiles),
      typeNaming: this.detectTypeNaming(srcFiles),
      importStyle: this.detectImportStyle(srcFiles),
      usesBarrelExports: this.detectBarrelExports(srcFiles),
      errorHandling: this.detectErrorHandling(srcFiles),
      validationLib: this.detectValidationLib(files),
      asyncPattern: this.detectAsyncPattern(srcFiles),
      exportStyle: this.detectExportStyle(srcFiles),
      indentation: this.detectIndentation(srcFiles),
      semicolons: this.detectSemicolons(srcFiles),
      quotes: this.detectQuotes(srcFiles),
      testFramework: this.detectTestFramework(testFiles),
      testPattern: this.detectTestPattern(testFiles),
      layers: this.detectLayers(srcFiles.map(f => f.relPath)),
      confidence: Math.min(srcFiles.length / 10, 1), // more files = more confident
    };
  }

  private detectFileNaming(paths: string[]): NamingConvention {
    const names = paths.map(p => basename(p, extname(p))).filter(n => n !== 'index');
    return this.classifyNamingBatch(names);
  }

  private detectVariableNaming(files: Array<{ content: string }>): NamingConvention {
    const names: string[] = [];
    for (const f of files.slice(0, 20)) {
      const matches = f.content.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
      if (matches) {
        for (const m of matches) {
          const name = m.replace(/^(?:const|let|var)\s+/, '');
          if (name.length > 2 && !name.startsWith('_')) names.push(name);
        }
      }
    }
    return this.classifyNamingBatch(names);
  }

  private detectTypeNaming(files: Array<{ content: string }>): NamingConvention {
    const names: string[] = [];
    for (const f of files.slice(0, 20)) {
      const matches = f.content.match(/(?:interface|type|class|enum)\s+([A-Z][a-zA-Z0-9]*)/g);
      if (matches) {
        for (const m of matches) {
          const name = m.replace(/^(?:interface|type|class|enum)\s+/, '');
          names.push(name);
        }
      }
    }
    return names.length > 0 ? 'PascalCase' : 'mixed'; // Types are almost always PascalCase
  }

  private detectImportStyle(files: Array<{ content: string }>): ImportStyle {
    let named = 0;
    let defaultImport = 0;
    for (const f of files.slice(0, 20)) {
      const namedMatches = f.content.match(/import\s*\{[^}]+\}\s*from/g);
      const defaultMatches = f.content.match(/import\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from/g);
      named += namedMatches?.length ?? 0;
      defaultImport += defaultMatches?.length ?? 0;
    }
    const total = named + defaultImport;
    if (total === 0) return 'named';
    if (named / total > 0.7) return 'named';
    if (defaultImport / total > 0.7) return 'default';
    return 'mixed';
  }

  private detectBarrelExports(files: Array<{ relPath: string; content: string }>): boolean {
    const indexFiles = files.filter(f => basename(f.relPath) === 'index.ts');
    if (indexFiles.length === 0) return false;
    const reExportCount = indexFiles.reduce((sum, f) => {
      const matches = f.content.match(/export\s+(?:\{[^}]+\}|\*)\s+from/g);
      return sum + (matches?.length ?? 0);
    }, 0);
    return reExportCount >= 3;
  }

  private detectErrorHandling(files: Array<{ content: string }>): ErrorStrategy {
    let throwCount = 0;
    let resultCount = 0;
    for (const f of files.slice(0, 20)) {
      throwCount += (f.content.match(/throw\s+new\s+\w*Error/g)?.length ?? 0);
      resultCount += (f.content.match(/Result<|Either<|\.ok\(|\.err\(|isOk|isErr/g)?.length ?? 0);
    }
    if (resultCount > throwCount && resultCount > 3) return 'result-pattern';
    if (throwCount > 0) return 'throw';
    return 'mixed';
  }

  private detectValidationLib(files: Array<{ path: string; content: string }>): string | null {
    const pkgPath = join(this.projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = readFileSync(pkgPath, 'utf-8');
      if (pkg.includes('"zod"')) return 'zod';
      if (pkg.includes('"joi"')) return 'joi';
      if (pkg.includes('"yup"')) return 'yup';
      if (pkg.includes('"class-validator"')) return 'class-validator';
    }
    // Fallback: check imports
    for (const f of files.slice(0, 30)) {
      if (f.content.includes("from 'zod'") || f.content.includes('from "zod"')) return 'zod';
      if (f.content.includes("from 'joi'") || f.content.includes('from "joi"')) return 'joi';
    }
    return null;
  }

  private detectAsyncPattern(files: Array<{ content: string }>): AsyncPattern {
    let asyncAwait = 0;
    let promiseThen = 0;
    for (const f of files.slice(0, 20)) {
      asyncAwait += (f.content.match(/async\s+(?:function|\(|[a-zA-Z])/g)?.length ?? 0);
      promiseThen += (f.content.match(/\.then\s*\(/g)?.length ?? 0);
    }
    if (asyncAwait > promiseThen * 2) return 'async-await';
    if (promiseThen > asyncAwait * 2) return 'promise-then';
    return asyncAwait > 0 ? 'async-await' : 'mixed';
  }

  private detectExportStyle(files: Array<{ content: string }>): ExportStyle {
    let named = 0;
    let defaultExport = 0;
    for (const f of files.slice(0, 20)) {
      named += (f.content.match(/export\s+(?:const|function|class|interface|type|enum)\s/g)?.length ?? 0);
      defaultExport += (f.content.match(/export\s+default\s/g)?.length ?? 0);
    }
    const total = named + defaultExport;
    if (total === 0) return 'named';
    if (named / total > 0.7) return 'named';
    if (defaultExport / total > 0.7) return 'default';
    return 'mixed';
  }

  private detectIndentation(files: Array<{ content: string }>): { style: 'spaces' | 'tabs'; size: number } {
    let spaces2 = 0;
    let spaces4 = 0;
    let tabs = 0;
    for (const f of files.slice(0, 10)) {
      const lines = f.content.split('\n').filter(l => l.startsWith(' ') || l.startsWith('\t'));
      for (const line of lines.slice(0, 50)) {
        if (line.startsWith('\t')) tabs++;
        else {
          const indent = line.match(/^( +)/)?.[1]?.length ?? 0;
          if (indent % 2 === 0 && indent <= 8) spaces2++;
          if (indent % 4 === 0 && indent <= 16) spaces4++;
        }
      }
    }
    if (tabs > spaces2 + spaces4) return { style: 'tabs', size: 1 };
    // If most indents are divisible by 4 but not just 2, it's 4-space
    if (spaces4 > spaces2 * 0.8) return { style: 'spaces', size: 4 };
    return { style: 'spaces', size: 2 };
  }

  private detectSemicolons(files: Array<{ content: string }>): boolean {
    let withSemi = 0;
    let withoutSemi = 0;
    for (const f of files.slice(0, 10)) {
      const lines = f.content.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 5 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('{') && !l.startsWith('}'));
      for (const line of lines.slice(0, 30)) {
        if (line.endsWith(';')) withSemi++;
        else if (line.match(/[a-zA-Z0-9'"`)\]]\s*$/)) withoutSemi++;
      }
    }
    return withSemi > withoutSemi;
  }

  private detectQuotes(files: Array<{ content: string }>): 'single' | 'double' {
    let single = 0;
    let double = 0;
    for (const f of files.slice(0, 10)) {
      single += (f.content.match(/from\s+'/g)?.length ?? 0);
      double += (f.content.match(/from\s+"/g)?.length ?? 0);
    }
    return single >= double ? 'single' : 'double';
  }

  private detectTestFramework(testFiles: Array<{ content: string }>): TestFramework {
    for (const f of testFiles.slice(0, 5)) {
      if (f.content.includes("from 'vitest'") || f.content.includes('from "vitest"')) return 'vitest';
      if (f.content.includes("from '@jest'") || f.content.includes("jest.")) return 'jest';
      if (f.content.includes("from 'mocha'") || f.content.includes('describe(')) return 'mocha';
    }
    // Check package.json
    const pkgPath = join(this.projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = readFileSync(pkgPath, 'utf-8');
      if (pkg.includes('"vitest"')) return 'vitest';
      if (pkg.includes('"jest"')) return 'jest';
      if (pkg.includes('"mocha"')) return 'mocha';
    }
    return 'unknown';
  }

  private detectTestPattern(testFiles: Array<{ content: string }>): 'describe-it' | 'test-fn' | 'mixed' {
    let describeIt = 0;
    let testFn = 0;
    for (const f of testFiles.slice(0, 10)) {
      describeIt += (f.content.match(/\bdescribe\s*\(/g)?.length ?? 0);
      describeIt += (f.content.match(/\bit\s*\(/g)?.length ?? 0);
      testFn += (f.content.match(/\btest\s*\(/g)?.length ?? 0);
    }
    if (describeIt > testFn * 2) return 'describe-it';
    if (testFn > describeIt * 2) return 'test-fn';
    return 'mixed';
  }

  private detectLayers(paths: string[]): string[] {
    const layers = new Set<string>();
    for (const p of paths) {
      if (/\broute[sr]?\b/i.test(p)) layers.add('routes');
      if (/\bcontroller[s]?\b/i.test(p)) layers.add('controllers');
      if (/\bservice[s]?\b/i.test(p)) layers.add('services');
      if (/\brepo(?:sitor(?:y|ies))?\b/i.test(p)) layers.add('repositories');
      if (/\bmodel[s]?\b/i.test(p)) layers.add('models');
      if (/\bschema[s]?\b/i.test(p)) layers.add('schemas');
      if (/\bmiddleware[s]?\b/i.test(p)) layers.add('middleware');
      if (/\butil[s]?\b/i.test(p)) layers.add('utils');
      if (/\bconfig\b/i.test(p)) layers.add('config');
    }
    return [...layers];
  }

  // ═══════════════════════════════════════════════════════════
  // Naming Classification
  // ═══════════════════════════════════════════════════════════

  private classifyNamingBatch(names: string[]): NamingConvention {
    if (names.length === 0) return 'mixed';

    let camel = 0;
    let pascal = 0;
    let snake = 0;
    let kebab = 0;

    for (const name of names) {
      if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) camel++;
      else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) pascal++;
      else if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes('_')) snake++;
      else if (/^[a-z][a-z0-9-]*$/.test(name) && name.includes('-')) kebab++;
      else if (/^[a-z][a-z0-9]*$/.test(name)) camel++; // simple lowercase = camel
    }

    const total = names.length;
    if (camel / total > 0.5) return 'camelCase';
    if (pascal / total > 0.5) return 'PascalCase';
    if (snake / total > 0.5) return 'snake_case';
    if (kebab / total > 0.5) return 'kebab-case';
    return 'mixed';
  }

  // ═══════════════════════════════════════════════════════════
  // Violation Detection
  // ═══════════════════════════════════════════════════════════

  private findViolations(
    files: Array<{ relPath: string; content: string }>,
    conventions: ProjectConventions
  ): ConventionViolation[] {
    const violations: ConventionViolation[] = [];

    for (const f of files) {
      if (f.relPath.includes('.test.') || f.relPath.includes('.spec.')) continue;

      const lines = f.content.split('\n');

      // Check semicolons
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (line.length < 5 || line.startsWith('//') || line.startsWith('*') || line.startsWith('{') || line.startsWith('}') || line.startsWith('import') || line.startsWith('export')) continue;

        if (conventions.semicolons && line.match(/[a-zA-Z0-9'"`)\]]\s*$/) && !line.endsWith('{') && !line.endsWith('(') && !line.endsWith(',')) {
          violations.push({
            rule: 'semicolons',
            file: f.relPath,
            line: i + 1,
            expected: 'semicolon at end of statement',
            actual: 'no semicolon',
            autoFixable: true,
          });
        }
      }

      // Check file naming
      const fileName = basename(f.relPath, extname(f.relPath));
      if (fileName !== 'index' && conventions.fileNaming === 'kebab-case' && /[A-Z_]/.test(fileName)) {
        violations.push({
          rule: 'file-naming',
          file: f.relPath,
          line: 0,
          expected: `kebab-case (e.g., ${fileName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')})`,
          actual: fileName,
          autoFixable: false,
        });
      }
    }

    // Limit violations to avoid noise
    return violations.slice(0, 50);
  }

  // ═══════════════════════════════════════════════════════════
  // Prompt Snippet Generation
  // ═══════════════════════════════════════════════════════════

  generatePromptSnippet(conventions: ProjectConventions): string {
    const rules: string[] = [];

    rules.push(`File naming: ${conventions.fileNaming} (e.g., user-service.ts)`);
    rules.push(`Variables: ${conventions.variableNaming}, Types: ${conventions.typeNaming}`);
    rules.push(`Imports: ${conventions.importStyle} imports${conventions.usesBarrelExports ? ', uses barrel exports (index.ts)' : ', NO barrel exports'}`);
    rules.push(`Exports: ${conventions.exportStyle} exports`);
    rules.push(`Error handling: ${conventions.errorHandling}`);
    if (conventions.validationLib) rules.push(`Validation: use ${conventions.validationLib}`);
    rules.push(`Async: ${conventions.asyncPattern}`);
    rules.push(`Style: ${conventions.indentation.size}-${conventions.indentation.style}, ${conventions.semicolons ? 'with' : 'without'} semicolons, ${conventions.quotes} quotes`);
    if (conventions.testFramework !== 'unknown') {
      rules.push(`Tests: ${conventions.testFramework}, ${conventions.testPattern} pattern`);
    }
    if (conventions.layers.length > 0) {
      rules.push(`Architecture layers: ${conventions.layers.join(', ')}`);
    }

    return `## Project Conventions (auto-detected, confidence: ${Math.round(conventions.confidence * 100)}%)\n\n${rules.map(r => `- ${r}`).join('\n')}`;
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private findSourceFiles(): string[] {
    const results: string[] = [];
    this.walkDirSync(this.projectRoot, results);
    return results;
  }

  private walkDirSync(dir: string, results: string[]): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'coverage') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDirSync(full, results);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          results.push(full);
        }
      }
    } catch { /* directory not readable */ }
  }

  private emptyReport(): ConventionReport {
    return {
      conventions: {
        fileNaming: 'mixed', variableNaming: 'mixed', typeNaming: 'PascalCase',
        importStyle: 'named', usesBarrelExports: false, errorHandling: 'mixed',
        validationLib: null, asyncPattern: 'mixed', exportStyle: 'named',
        indentation: { style: 'spaces', size: 2 }, semicolons: true, quotes: 'single',
        testFramework: 'unknown', testPattern: 'mixed', layers: [], confidence: 0,
      },
      violations: [],
      promptSnippet: '## No conventions detected (empty project)',
      summary: { totalFiles: 0, violationCount: 0, autoFixable: 0 },
    };
  }
}
