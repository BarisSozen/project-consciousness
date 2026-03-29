/**
 * Context Accumulator — Incremental Code Context for Agent Memory
 *
 * Problem: Agent Task 3 doesn't know what Task 1-2 built.
 * Solution: After each task, scan produced files and extract a summary
 * (exports, key types, function signatures) → append to STATE.md.
 *
 * Next agent reads STATE.md → sees "User model has id, name, email fields"
 * → writes code that actually matches.
 */

import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface FileSummary {
  file: string;
  exports: string[];
  types: string[];
  functions: string[];
}

export interface AccumulatedContext {
  /** Per-file summaries of what was built */
  files: FileSummary[];
  /** Markdown section for STATE.md */
  markdown: string;
}

export interface RankedFileSummary extends FileSummary {
  /** 0-1 relevance score relative to current task */
  relevanceScore: number;
}

export class ContextAccumulator {
  private projectRoot: string;
  /** Running context — grows with each task */
  private accumulated: FileSummary[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * After a task completes, scan its artifacts and accumulate context.
   * Returns a markdown section to append to STATE.md.
   */
  accumulate(artifacts: string[]): AccumulatedContext {
    const newFiles: FileSummary[] = [];

    for (const artifact of artifacts) {
      if (!artifact.match(/\.(ts|tsx)$/) || artifact.match(/\.(test|spec|d)\./)) continue;

      const absPath = join(this.projectRoot, artifact);
      if (!existsSync(absPath)) continue;

      const summary = this.summarizeFile(absPath, artifact);
      if (summary.exports.length > 0 || summary.types.length > 0 || summary.functions.length > 0) {
        // Update or add
        const existing = this.accumulated.findIndex(f => f.file === artifact);
        if (existing >= 0) {
          this.accumulated[existing] = summary;
        } else {
          this.accumulated.push(summary);
        }
        newFiles.push(summary);
      }
    }

    return {
      files: this.accumulated,
      markdown: this.renderMarkdown(),
    };
  }

  /**
   * Get current accumulated context as markdown.
   */
  getMarkdown(): string {
    return this.renderMarkdown();
  }

  /**
   * Get the full accumulated file list.
   */
  getFiles(): FileSummary[] {
    return [...this.accumulated];
  }

  /**
   * Task-relevant ranking — sadece mevcut task için önemli export'ları döndür.
   * Keyword eşleşmesi ile relevance score hesaplar.
   *
   * @param taskDescription Mevcut task'ın açıklaması
   * @param topN En alakalı kaç dosya döndürülsün (default: 10)
   */
  getRankedContext(taskDescription: string, topN = 10): AccumulatedContext {
    if (this.accumulated.length === 0) {
      return { files: [], markdown: '' };
    }

    const keywords = this.extractKeywords(taskDescription);
    const ranked: RankedFileSummary[] = this.accumulated.map(file => ({
      ...file,
      relevanceScore: this.computeRelevance(file, keywords),
    }));

    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const top = ranked.slice(0, topN).filter(f => f.relevanceScore > 0);

    return {
      files: top,
      markdown: this.renderRankedMarkdown(top),
    };
  }

  /**
   * Task description'ından keyword'leri çıkar.
   */
  private extractKeywords(description: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'and', 'or',
      'but', 'if', 'then', 'else', 'when', 'up', 'out', 'on', 'off', 'over',
      'under', 'again', 'further', 'once', 'all', 'each', 'every', 'both',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'as',
      'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'between',
      'through', 'from', 'to', 'in', 'into', 'during', 'before', 'after',
      'this', 'that', 'these', 'those', 'it', 'its', 'create', 'implement',
      'add', 'write', 'build', 'make', 'update', 'dosya', 'yaz', 'oluştur',
      'ekle', 'güncelle', 'yap',
    ]);

    return description
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Dosya özetini keyword'lere göre skorla.
   */
  private computeRelevance(file: FileSummary, keywords: string[]): number {
    if (keywords.length === 0) return 0.5; // keyword yoksa orta skor

    const fileText = [
      file.file,
      ...file.exports,
      ...file.types,
      ...file.functions,
    ].join(' ').toLowerCase();

    let matches = 0;
    for (const kw of keywords) {
      if (fileText.includes(kw)) {
        matches++;
      }
    }

    return matches / keywords.length;
  }

  /**
   * Ranked context'i markdown olarak render et.
   */
  private renderRankedMarkdown(ranked: RankedFileSummary[]): string {
    if (ranked.length === 0) return '';

    const lines: string[] = ['## Built Artifacts (ranked by relevance)\n'];

    for (const file of ranked) {
      const score = Math.round(file.relevanceScore * 100);
      lines.push(`### ${file.file} (${score}% relevant)`);
      if (file.types.length > 0) {
        lines.push(`Types: ${file.types.join('; ')}`);
      }
      if (file.functions.length > 0) {
        lines.push(`Functions: ${file.functions.join(', ')}`);
      }
      if (file.exports.length > 0 && file.types.length === 0 && file.functions.length === 0) {
        lines.push(`Exports: ${file.exports.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // File Summarization (AST-based)
  // ═══════════════════════════════════════════════════════════

  private summarizeFile(absPath: string, relPath: string): FileSummary {
    const content = readFileSync(absPath, 'utf-8');
    const sf = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true);

    const exports: string[] = [];
    const types: string[] = [];
    const functions: string[] = [];

    const visit = (node: ts.Node) => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      if (isExported) {
        if (ts.isInterfaceDeclaration(node)) {
          const fields = node.members
            .filter(ts.isPropertySignature)
            .map(m => {
              const name = m.name && ts.isIdentifier(m.name) ? m.name.text : '?';
              const type = m.type ? content.slice(m.type.pos, m.type.end).trim() : 'unknown';
              return `${name}: ${type}`;
            })
            .slice(0, 10);
          types.push(`interface ${node.name.text} { ${fields.join('; ')} }`);
          exports.push(node.name.text);
        } else if (ts.isTypeAliasDeclaration(node)) {
          types.push(`type ${node.name.text}`);
          exports.push(node.name.text);
        } else if (ts.isFunctionDeclaration(node) && node.name) {
          const params = node.parameters
            .map(p => {
              const name = ts.isIdentifier(p.name) ? p.name.text : '?';
              const type = p.type ? content.slice(p.type.pos, p.type.end).trim() : 'any';
              return `${name}: ${type}`;
            })
            .join(', ');
          const ret = node.type ? content.slice(node.type.pos, node.type.end).trim() : 'void';
          functions.push(`${node.name.text}(${params}): ${ret}`);
          exports.push(node.name.text);
        } else if (ts.isClassDeclaration(node) && node.name) {
          const methods = node.members
            .filter(ts.isMethodDeclaration)
            .filter(m => m.name && ts.isIdentifier(m.name))
            .map(m => (m.name as ts.Identifier).text)
            .slice(0, 8);
          types.push(`class ${node.name.text} { ${methods.join(', ')} }`);
          exports.push(node.name.text);
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const init = decl.initializer;
              if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
                functions.push(decl.name.text + '(...)');
              }
              exports.push(decl.name.text);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
    return { file: relPath, exports, types, functions };
  }

  // ═══════════════════════════════════════════════════════════
  // Markdown Rendering
  // ═══════════════════════════════════════════════════════════

  private renderMarkdown(): string {
    if (this.accumulated.length === 0) return '';

    const lines: string[] = ['## Built Artifacts\n'];

    for (const file of this.accumulated) {
      lines.push(`### ${file.file}`);
      if (file.types.length > 0) {
        lines.push(`Types: ${file.types.join('; ')}`);
      }
      if (file.functions.length > 0) {
        lines.push(`Functions: ${file.functions.join(', ')}`);
      }
      if (file.exports.length > 0 && file.types.length === 0 && file.functions.length === 0) {
        lines.push(`Exports: ${file.exports.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
