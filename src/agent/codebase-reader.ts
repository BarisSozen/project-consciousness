/**
 * Codebase Reader — Proje Dosyalarını Otomatik Okuyan Modül
 *
 * Her agent task başlamadan önce ilgili dosyaları otomatik okur.
 * Task açıklamasına göre hangi dosyaların gerektiğine karar verir.
 *
 * D007: Memory-Aware Context Injection — codebase context eklenir
 * D018: Hafıza optimizasyonu — max 8000 token limiti
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type {
  FileInfo,
  ProjectStructure,
  FileContext,
  CodebaseContext,
} from '../types/index.js';

/** Token yaklaşık hesabı: 1 token ≈ 4 karakter */
const CHARS_PER_TOKEN = 4;
const MAX_TOKENS = 8000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;
const FIRST_LINES_COUNT = 50;

/** Taranması gereken kaynak dosya uzantıları */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.sql', '.graphql', '.gql',
  '.css', '.scss', '.html', '.vue', '.svelte',
]);

/** Her zaman atlanacak dizinler */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.output', '__pycache__', '.cache',
  'vendor', 'target', '.turbo', '.vercel',
]);

/** Task pattern → ilgili dosya anahtar kelimeleri eşleştirmesi */
const TASK_FILE_PATTERNS: Array<{
  keywords: string[];
  filePatterns: string[];
  priority: number;
}> = [
  {
    keywords: ['auth', 'authentication', 'login', 'register', 'jwt', 'session', 'token'],
    filePatterns: ['auth', 'user', 'session', 'token', 'middleware', 'guard', 'login', 'register', 'schema', 'config'],
    priority: 10,
  },
  {
    keywords: ['database', 'db', 'schema', 'migration', 'model', 'entity'],
    filePatterns: ['schema', 'model', 'entity', 'migration', 'db', 'database', 'prisma', 'drizzle', 'knex'],
    priority: 9,
  },
  {
    keywords: ['api', 'endpoint', 'route', 'controller', 'handler', 'rest', 'graphql'],
    filePatterns: ['route', 'controller', 'handler', 'api', 'endpoint', 'server', 'app', 'middleware', 'schema'],
    priority: 8,
  },
  {
    keywords: ['frontend', 'component', 'page', 'ui', 'view', 'layout', 'style'],
    filePatterns: ['component', 'page', 'view', 'layout', 'style', 'hook', 'context', 'store', 'api', 'types'],
    priority: 7,
  },
  {
    keywords: ['test', 'testing', 'spec', 'unit', 'integration', 'e2e'],
    filePatterns: ['test', 'spec', '__tests__', 'fixture', 'mock', 'helper'],
    priority: 6,
  },
  {
    keywords: ['config', 'setup', 'env', 'environment', 'settings'],
    filePatterns: ['config', 'env', 'settings', 'constants', '.env', 'tsconfig', 'package'],
    priority: 5,
  },
  {
    keywords: ['deploy', 'docker', 'ci', 'cd', 'pipeline', 'build'],
    filePatterns: ['docker', 'ci', 'deploy', 'pipeline', 'workflow', 'Makefile', 'Dockerfile'],
    priority: 4,
  },
];

export class CodebaseReader {
  /**
   * Proje dizinini tara, tüm kaynak dosyaları ve dizin yapısını çıkar.
   */
  async scanProject(projectRoot: string): Promise<ProjectStructure> {
    const files: FileInfo[] = [];
    const directories: string[] = [];

    await this.walkDirectory(projectRoot, projectRoot, files, directories);

    return {
      root: projectRoot,
      files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      directories: directories.sort(),
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    };
  }

  /**
   * Task açıklamasına göre hangi dosyaların okunması gerektiğine karar ver.
   * Architecture bilgisini de kullanarak daha akıllı seçim yapar.
   */
  getRelevantFiles(
    task: string,
    structure: ProjectStructure,
    architecture?: string
  ): FileInfo[] {
    const taskLower = task.toLowerCase();
    const scored: Array<{ file: FileInfo; score: number }> = [];

    for (const file of structure.files) {
      let score = 0;

      // 1. Task pattern eşleştirmesi
      for (const pattern of TASK_FILE_PATTERNS) {
        const taskMatch = pattern.keywords.some(kw => taskLower.includes(kw));
        if (taskMatch) {
          const fileMatch = pattern.filePatterns.some(fp =>
            file.relativePath.toLowerCase().includes(fp)
          );
          if (fileMatch) {
            score += pattern.priority;
          }
        }
      }

      // 2. Doğrudan dosya adı eşleşmesi (task'ta geçen kelimeler)
      const taskWords = taskLower
        .split(/[\s,.;:!?/\\-]+/)
        .filter(w => w.length > 2);
      for (const word of taskWords) {
        if (file.relativePath.toLowerCase().includes(word)) {
          score += 3;
        }
      }

      // 3. Architecture'da bahsedilen dosya/dizin eşleşmesi
      if (architecture) {
        const archLower = architecture.toLowerCase();
        const pathParts = file.relativePath.split('/');
        for (const part of pathParts) {
          if (part.length > 2 && archLower.includes(part.toLowerCase())) {
            score += 2;
          }
        }
      }

      // 4. Temel dosyalar her zaman biraz puan alır
      if (this.isCoreFile(file.relativePath)) {
        score += 1;
      }

      // 5. Index/types dosyaları ek puan
      const baseName = file.relativePath.split('/').pop()?.toLowerCase() ?? '';
      if (baseName.startsWith('index.') || baseName.includes('types')) {
        score += 1;
      }

      if (score > 0) {
        scored.push({ file, score });
      }
    }

    // Skora göre sırala, en yüksek önce
    scored.sort((a, b) => b.score - a.score);

    return scored.map(s => s.file);
  }

  /**
   * Dosya listesinden context özeti oluştur.
   * Her dosya: path + ilk 50 satır + export'lar.
   * Max 8000 token limiti.
   */
  async buildContextSummary(
    files: FileInfo[],
    projectRoot: string
  ): Promise<CodebaseContext> {
    const contexts: FileContext[] = [];
    let totalChars = 0;
    let truncated = false;

    for (const file of files) {
      if (totalChars >= MAX_CHARS) {
        truncated = true;
        break;
      }

      try {
        const fullPath = join(projectRoot, file.relativePath);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        // İlk N satır
        const firstLines = lines.slice(0, FIRST_LINES_COUNT).join('\n');

        // Export'ları çıkar
        const exports = this.extractExports(content, file.extension);

        const contextEntry: FileContext = {
          path: file.relativePath,
          firstLines,
          exports,
          relevanceScore: 0, // dışarıdan set edilir
        };

        // Bu entry'nin tahmini karakter maliyeti
        const entryCost =
          file.relativePath.length +
          firstLines.length +
          exports.join(', ').length +
          50; // overhead

        if (totalChars + entryCost > MAX_CHARS) {
          // Bu dosya sığmıyor — sadece path + exports ekle
          contextEntry.firstLines = `[truncated — ${lines.length} lines, ${file.size} bytes]`;
          const reducedCost = file.relativePath.length + exports.join(', ').length + 80;
          if (totalChars + reducedCost > MAX_CHARS) {
            truncated = true;
            break;
          }
          totalChars += reducedCost;
        } else {
          totalChars += entryCost;
        }

        contexts.push(contextEntry);
      } catch {
        // Dosya okunamadı, atla
      }
    }

    const summary = this.renderSummary(contexts);

    return {
      files: contexts,
      totalTokens: Math.ceil(totalChars / CHARS_PER_TOKEN),
      truncated,
      summary,
    };
  }

  // ── Private Helpers ─────────────────────────────────────

  private async walkDirectory(
    dir: string,
    root: string,
    files: FileInfo[],
    directories: string[]
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Erişilemeyen dizin, atla
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(root, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        directories.push(relPath);
        await this.walkDirectory(fullPath, root, files, directories);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;

        try {
          const fileStat = await stat(fullPath);
          files.push({
            path: fullPath,
            relativePath: relPath,
            size: fileStat.size,
            extension: ext,
          });
        } catch {
          // stat başarısız, atla
        }
      }
    }
  }

  /** Export statement'ları çıkar */
  private extractExports(content: string, extension: string): string[] {
    const exports: string[] = [];

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
      // TypeScript/JavaScript exports
      const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum)\s+(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = exportRegex.exec(content)) !== null) {
        if (match[1]) exports.push(match[1]);
      }

      // Re-exports: export { X, Y } from '...'
      const reExportRegex = /export\s*\{([^}]+)\}/g;
      while ((match = reExportRegex.exec(content)) !== null) {
        if (match[1]) {
          const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]?.trim() ?? '');
          exports.push(...names.filter(n => n.length > 0));
        }
      }
    } else if (extension === '.py') {
      // Python: def/class at top level
      const pyRegex = /^(?:def|class)\s+(\w+)/gm;
      let match: RegExpExecArray | null;
      while ((match = pyRegex.exec(content)) !== null) {
        if (match[1]) exports.push(match[1]);
      }
    } else if (extension === '.go') {
      // Go: Exported = capitalized
      const goRegex = /^(?:func|type|var|const)\s+([A-Z]\w+)/gm;
      let match: RegExpExecArray | null;
      while ((match = goRegex.exec(content)) !== null) {
        if (match[1]) exports.push(match[1]);
      }
    }

    // Deduplicate
    return [...new Set(exports)];
  }

  /** Temel proje dosyası mı? */
  private isCoreFile(relativePath: string): boolean {
    const corePaths = [
      'package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod',
      'Cargo.toml', 'pom.xml', 'build.gradle',
    ];
    return corePaths.some(cp => relativePath.endsWith(cp));
  }

  /** Context'i okunabilir metin olarak render et */
  private renderSummary(contexts: FileContext[]): string {
    if (contexts.length === 0) {
      return '_Codebase context bulunamadı._';
    }

    const parts: string[] = [];

    for (const ctx of contexts) {
      const exportStr = ctx.exports.length > 0
        ? `\nExports: ${ctx.exports.join(', ')}`
        : '';

      parts.push(`### ${ctx.path}${exportStr}
\`\`\`
${ctx.firstLines}
\`\`\``);
    }

    return parts.join('\n\n');
  }
}
