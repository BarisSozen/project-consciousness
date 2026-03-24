/**
 * API Docs Generator — Route tanımlarından OpenAPI spec üret
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export interface APIEndpoint {
  method: string;
  path: string;
  file: string;
  hasValidation: boolean;
  responseStatus?: number;
}

export class APIDocsGenerator {
  private root: string;

  constructor(projectRoot: string) {
    this.root = projectRoot;
  }

  /**
   * Scan routes, generate OpenAPI 3.0 spec.
   */
  async generate(title = 'API', version = '1.0.0'): Promise<{ spec: Record<string, unknown>; endpoints: APIEndpoint[] }> {
    const files = await this.collectFiles();
    const endpoints: APIEndpoint[] = [];

    for (const file of files) {
      if (!file.includes('route') && !file.includes('controller') && !file.includes('api')) continue;
      let content: string;
      try { content = await readFile(join(this.root, file), 'utf-8'); } catch { continue; }

      // Express route pattern: router.get('/path', ...)
      const regex = /\.(?:get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const method = match[0].match(/\.(get|post|put|delete|patch)/i)?.[1]?.toUpperCase() ?? 'GET';
        const path = match[1]!;
        const hasValidation = content.includes('safeParse') || content.includes('validate');
        endpoints.push({ method, path, file, hasValidation });
      }
    }

    const paths: Record<string, Record<string, unknown>> = {};
    for (const ep of endpoints) {
      const oaPath = ep.path.replace(/:(\w+)/g, '{$1}');
      if (!paths[oaPath]) paths[oaPath] = {};
      paths[oaPath][ep.method.toLowerCase()] = {
        summary: `${ep.method} ${ep.path}`,
        tags: [ep.file.split('/').slice(-1)[0]?.replace(/\.ts$/, '') ?? 'default'],
        parameters: (ep.path.match(/:(\w+)/g) ?? []).map(p => ({
          name: p.slice(1),
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })),
        responses: {
          '200': { description: 'Success' },
          ...(ep.method === 'POST' ? { '201': { description: 'Created' } } : {}),
          '400': { description: 'Bad Request' },
          '404': { description: 'Not Found' },
        },
      };
    }

    const spec = {
      openapi: '3.0.0',
      info: { title, version },
      paths,
    };

    // Write spec file
    await writeFile(join(this.root, 'openapi.json'), JSON.stringify(spec, null, 2));

    return { spec, endpoints };
  }

  private async collectFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
          await walk(join(dir, e.name));
        } else if (e.isFile() && ['.ts', '.js'].includes(extname(e.name))) {
          files.push(relative(this.root, join(dir, e.name)).replace(/\\/g, '/'));
        }
      }
    };
    await walk(this.root);
    return files;
  }
}
