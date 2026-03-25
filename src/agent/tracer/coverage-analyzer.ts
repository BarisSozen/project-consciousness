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

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
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
      return {
        ...realData,
        riskZones,
        summary: { ...realData.summary, riskZoneCount: riskZones.length },
      };
    }

    // Fallback to heuristic
    const heuristic = await this.heuristicCoverage();
    const riskZones = await this.calculateRiskZones(heuristic.files);
    return {
      ...heuristic,
      riskZones,
      summary: { ...heuristic.summary, riskZoneCount: riskZones.length },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Mode 1: Real Istanbul/v8 coverage data
  // ═══════════════════════════════════════════════════════════

  private async tryRealCoverage(): Promise<Omit<CoverageIntelReport, 'riskZones'> | null> {
    const coveragePaths = [
      join(this.projectRoot, 'coverage', 'coverage-final.json'),
      join(this.projectRoot, '.nyc_output', 'coverage-final.json'),
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

      const stmtTotal = Object.keys(fileCov.s).length;
      const stmtCovered = Object.values(fileCov.s).filter(v => v > 0).length;

      const fnTotal = Object.keys(fileCov.f).length;
      const fnCovered = Object.values(fileCov.f).filter(v => v > 0).length;

      const branchTotal = Object.values(fileCov.b).reduce((s, arr) => s + arr.length, 0);
      const branchCovered = Object.values(fileCov.b).reduce((s, arr) => s + arr.filter(v => v > 0).length, 0);

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
        riskZoneCount: 0,
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

    // Also check for co-located test files
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
      !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts')
    );

    let coveredCount = 0;

    for (const file of srcOnly) {
      const base = basename(file).replace(/\.(ts|tsx|js|jsx)$/, '');
      const hasCoverage = testBases.has(base);
      if (hasCoverage) coveredCount++;

      files.push({
        file,
        lines: { total: 0, covered: 0, percent: hasCoverage ? 50 : 0 },
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
      return [];
    }

    const riskZones: RiskZone[] = [];

    for (const fn of complexityReport.functions) {
      if (fn.rating === 'ok') continue;

      const fileCov = files.find(f =>
        f.file === fn.file || fn.file.endsWith(f.file) || f.file.endsWith(fn.file)
      );
      const coveragePercent = fileCov?.lines.percent ?? 0;

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
