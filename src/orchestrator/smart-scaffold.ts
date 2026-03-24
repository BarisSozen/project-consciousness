/**
 * Smart Scaffold — Brief'ten Multi-Entity Layered Code Generation
 *
 * EntityDetector sonuçlarını alıp her entity için:
 * - Route (Express router + CRUD + relation endpoints)
 * - Service (business logic)
 * - Repository (data access)
 * - Schema (Zod validation)
 * - DB model (Drizzle-style)
 * üretir.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EntityDetector } from './entity-detector.js';
import type { DetectedEntity, DetectedRelation, EntityDetectionResult } from './entity-detector.js';
import type { ArchitectureDecisions } from '../types/index.js';

export interface SmartScaffoldResult {
  files: string[];
  routes: string[];
  entities: string[];
  detection: EntityDetectionResult;
}

export class SmartScaffold {
  private root: string;
  private detector: EntityDetector;

  constructor(projectRoot: string) {
    this.root = projectRoot;
    this.detector = new EntityDetector();
  }

  async generate(brief: string, decisions: ArchitectureDecisions): Promise<SmartScaffoldResult> {
    const detection = this.detector.detect(brief);
    const files: string[] = [];
    const routes: string[] = [];

    // Directories
    const dirs = [
      'src', 'src/routes', 'src/services', 'src/middleware',
      'src/config', 'src/schemas', 'src/models', 'tests',
      ...(decisions.database !== 'in-memory' ? ['src/repositories'] : []),
    ];
    for (const d of dirs) await mkdir(join(this.root, d), { recursive: true });

    // Config
    files.push(await this.writeConfig(decisions));

    // App + server
    files.push(await this.writeApp(detection, decisions));
    files.push(await this.writeServer());

    // Health endpoint
    files.push(await this.writeHealthRoute());
    routes.push('GET /health');

    // Auth (if auth entity exists)
    const authEntity = detection.entities.find(e => e.isAuthEntity);
    if (authEntity && decisions.auth !== 'none') {
      files.push(...await this.writeAuth(authEntity, decisions));
      routes.push('POST /auth/register', 'POST /auth/login', 'GET /auth/me');
    }

    // Each entity → route + service + repo + schema
    for (const entity of detection.entities) {
      if (entity.isAuthEntity) continue; // auth handled above

      files.push(await this.writeSchema(entity));
      files.push(await this.writeService(entity, decisions));
      if (decisions.database !== 'in-memory') {
        files.push(await this.writeRepository(entity));
      }
      files.push(await this.writeRoute(entity, detection.relations));

      for (const ep of detection.endpoints.find(e => e.entity === entity.name)?.routes ?? []) {
        routes.push(`${ep.method} ${ep.path}`);
      }
    }

    // DB model (all entities in one file)
    files.push(await this.writeModels(detection));

    return {
      files,
      routes,
      entities: detection.entities.map(e => e.name),
      detection,
    };
  }

  // ── Generators ──────────────────────────────────────────

  private async writeConfig(d: ArchitectureDecisions): Promise<string> {
    const path = 'src/config/index.ts';
    const content = `import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
${d.database === 'postgresql' ? "  DATABASE_URL: z.string().default('postgresql://localhost:5432/app')," : ''}
${d.database === 'sqlite' ? "  DB_PATH: z.string().default('./data.sqlite')," : ''}
${d.auth === 'jwt' ? "  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters')," : ''}
});

export type Config = z.infer<typeof envSchema>;

// Validate at startup — fail fast
let _config: Config;
try {
  _config = envSchema.parse(process.env);
} catch (err) {
  console.error('❌ Invalid environment configuration:', err);
  process.exit(1);
}
export const config = _config;
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeApp(det: EntityDetectionResult, d: ArchitectureDecisions): Promise<string> {
    const path = 'src/app.ts';
    const imports: string[] = ["import express from 'express';"];
    const mounts: string[] = [];

    // Health
    imports.push("import { healthRouter } from './routes/health.js';");
    mounts.push("app.use('/health', healthRouter);");

    // Auth
    const hasAuth = det.entities.some(e => e.isAuthEntity) && d.auth !== 'none';
    if (hasAuth) {
      imports.push("import { authRouter } from './routes/auth.js';");
      imports.push("import { authMiddleware } from './middleware/auth.js';");
      mounts.push("app.use('/auth', authRouter);");
    }

    // Entity routes
    for (const entity of det.entities) {
      if (entity.isAuthEntity) continue;
      const varName = `${entity.slug}Router`;
      imports.push(`import { ${varName} } from './routes/${entity.pluralSlug}.js';`);
      if (hasAuth) {
        mounts.push(`app.use('/${entity.pluralSlug}', authMiddleware, ${varName});`);
      } else {
        mounts.push(`app.use('/${entity.pluralSlug}', ${varName});`);
      }
    }

    const content = `${imports.join('\n')}

export const app = express();
app.use(express.json());

// Routes
${mounts.join('\n')}
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeServer(): Promise<string> {
    const path = 'src/server.ts';
    const content = `import { app } from './app.js';
import { config } from './config/index.js';

app.listen(config.PORT, () => {
  console.log(\`Server listening on port \${config.PORT}\`);
});
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeHealthRoute(): Promise<string> {
    const path = 'src/routes/health.ts';
    const content = `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeSchema(entity: DetectedEntity): Promise<string> {
    const path = `src/schemas/${entity.slug}.ts`;
    const fields = entity.fields
      .filter(f => f.name !== 'userId') // userId comes from auth
      .map(f => {
        let zodType = 'z.string()';
        if (f.type === 'number') zodType = 'z.number()';
        else if (f.type === 'boolean') zodType = 'z.boolean().default(false)';
        else if (f.type === 'date') zodType = 'z.string().datetime().optional()';
        else if (f.type === 'reference') zodType = 'z.string().uuid()';
        if (!f.required && f.type !== 'boolean' && f.type !== 'date') zodType += '.optional()';
        return `  ${f.name}: ${zodType},`;
      })
      .join('\n');

    const content = `import { z } from 'zod';

export const create${entity.name}Schema = z.object({
${fields}
});

export const update${entity.name}Schema = create${entity.name}Schema.partial();

export type Create${entity.name}Input = z.infer<typeof create${entity.name}Schema>;
export type Update${entity.name}Input = z.infer<typeof update${entity.name}Schema>;
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeService(entity: DetectedEntity, d: ArchitectureDecisions): Promise<string> {
    const path = `src/services/${entity.slug}-service.ts`;
    const usesRepo = d.database !== 'in-memory';
    const E = entity.name;
    const items = entity.pluralSlug;

    const content = usesRepo ? `import { ${E}Repository } from '../repositories/${entity.slug}-repo.js';
import type { Create${E}Input, Update${E}Input } from '../schemas/${entity.slug}.js';

export class ${E}Service {
  private repo = new ${E}Repository();

  findAll(userId?: string) { return this.repo.findAll(userId); }
  findById(id: string) { return this.repo.findById(id); }
  create(data: Create${E}Input, userId?: string) { return this.repo.create({ ...data, userId }); }
  update(id: string, data: Update${E}Input) { return this.repo.update(id, data); }
  delete(id: string) { return this.repo.delete(id); }
}
` : `import type { Create${E}Input, Update${E}Input } from '../schemas/${entity.slug}.js';

interface ${E} { id: string; [key: string]: unknown; }

export class ${E}Service {
  private ${items}: ${E}[] = [];
  private counter = 0;

  findAll(userId?: string): ${E}[] {
    return userId ? this.${items}.filter(i => i.userId === userId) : this.${items};
  }
  findById(id: string): ${E} | undefined { return this.${items}.find(i => i.id === id); }
  create(data: Create${E}Input & { userId?: string }): ${E} {
    const item: ${E} = { ...data, id: String(++this.counter) };
    this.${items}.push(item);
    return item;
  }
  update(id: string, data: Update${E}Input): ${E} | undefined {
    const idx = this.${items}.findIndex(i => i.id === id);
    if (idx < 0) return undefined;
    this.${items}[idx] = { ...this.${items}[idx]!, ...data, id };
    return this.${items}[idx];
  }
  delete(id: string): boolean {
    const idx = this.${items}.findIndex(i => i.id === id);
    if (idx < 0) return false;
    this.${items}.splice(idx, 1);
    return true;
  }
}
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeRepository(entity: DetectedEntity): Promise<string> {
    const path = `src/repositories/${entity.slug}-repo.ts`;
    const E = entity.name;
    const content = `/**
 * ${E} Repository — data access layer
 * TODO: Replace with real database queries
 */

interface ${E} { id: string; [key: string]: unknown; }

export class ${E}Repository {
  private items: ${E}[] = [];
  private counter = 0;

  findAll(userId?: string): ${E}[] {
    return userId ? this.items.filter(i => i.userId === userId) : this.items;
  }
  findById(id: string): ${E} | undefined { return this.items.find(i => i.id === id); }
  create(data: Record<string, unknown>): ${E} {
    const item = { ...data, id: String(++this.counter) } as ${E};
    this.items.push(item);
    return item;
  }
  update(id: string, data: Record<string, unknown>): ${E} | undefined {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx < 0) return undefined;
    this.items[idx] = { ...this.items[idx]!, ...data, id };
    return this.items[idx];
  }
  delete(id: string): boolean {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    return true;
  }
}
`;
    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeRoute(entity: DetectedEntity, _relations: DetectedRelation[]): Promise<string> {
    const path = `src/routes/${entity.pluralSlug}.ts`;
    const E = entity.name;
    const service = `${entity.slug}Service`;
    const validation = `create${E}Schema`;
    const updateValidation = `update${E}Schema`;

    let content = `import { Router } from 'express';
import { ${E}Service } from '../services/${entity.slug}-service.js';
import { ${validation}, ${updateValidation} } from '../schemas/${entity.slug}.js';

export const ${entity.slug}Router = Router();
const ${service} = new ${E}Service();

// GET /${entity.pluralSlug}
${entity.slug}Router.get('/', (req, res) => {
  const userId = (req as any).userId; // from auth middleware
  const items = ${service}.findAll(userId);
  res.json(items);
});

// GET /${entity.pluralSlug}/:id
${entity.slug}Router.get('/:id', (req, res) => {
  const item = ${service}.findById(req.params.id!);
  if (!item) { res.status(404).json({ error: '${E} not found' }); return; }
  res.json(item);
});

// POST /${entity.pluralSlug}
${entity.slug}Router.post('/', (req, res) => {
  const parsed = ${validation}.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const userId = (req as any).userId;
  const item = ${service}.create(parsed.data, userId);
  res.status(201).json(item);
});

// PUT /${entity.pluralSlug}/:id
${entity.slug}Router.put('/:id', (req, res) => {
  const parsed = ${updateValidation}.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const item = ${service}.update(req.params.id!, parsed.data);
  if (!item) { res.status(404).json({ error: '${E} not found' }); return; }
  res.json(item);
});

// DELETE /${entity.pluralSlug}/:id
${entity.slug}Router.delete('/:id', (req, res) => {
  const ok = ${service}.delete(req.params.id!);
  if (!ok) { res.status(404).json({ error: '${E} not found' }); return; }
  res.status(204).end();
});
`;

    await writeFile(join(this.root, path), content);
    return path;
  }

  private async writeAuth(_entity: DetectedEntity, _d: ArchitectureDecisions): Promise<string[]> {
    const files: string[] = [];

    // Auth route
    const routeContent = `import { Router } from 'express';
import { z } from 'zod';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// In-memory store (replace with real DB)
const users: Array<{ id: string; email: string; password: string; name: string }> = [];
let counter = 0;

authRouter.post('/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const exists = users.find(u => u.email === parsed.data.email);
  if (exists) { res.status(409).json({ error: 'Email already registered' }); return; }
  const user = { id: String(++counter), ...parsed.data };
  users.push(user);
  res.status(201).json({ id: user.id, email: user.email, name: user.name });
});

authRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const user = users.find(u => u.email === parsed.data.email && u.password === parsed.data.password);
  if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }
  res.json({ token: \`token-\${user.id}-\${Date.now()}\`, userId: user.id });
});
`;
    await writeFile(join(this.root, 'src/routes/auth.ts'), routeContent);
    files.push('src/routes/auth.ts');

    // Auth middleware
    const middlewareContent = `import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  // TODO: Validate token properly (JWT verify)
  const userId = token.split('-')[1]; // extract from token-{userId}-{timestamp}
  (req as any).userId = userId;
  next();
}
`;
    await writeFile(join(this.root, 'src/middleware/auth.ts'), middlewareContent);
    files.push('src/middleware/auth.ts');

    return files;
  }

  private async writeModels(det: EntityDetectionResult): Promise<string> {
    const path = 'src/models/schema.ts';
    const tables = det.entities.map(entity => {
      const fields = entity.fields.map(f => {
        const colType = f.type === 'number' ? 'integer' :
          f.type === 'boolean' ? 'boolean' :
          f.type === 'date' ? 'timestamp' :
          f.type === 'reference' ? `text /* FK → ${f.reference} */` :
          'text';
        return `  ${f.name}: ${colType}('${f.name}')${f.required ? '.notNull()' : ''},`;
      }).join('\n');

      return `// ${entity.name}
export const ${entity.pluralSlug} = {
  tableName: '${entity.pluralSlug}',
  columns: {
    id: 'text("id").primaryKey()',
${fields}
    createdAt: 'timestamp("created_at").defaultNow()',
    updatedAt: 'timestamp("updated_at").defaultNow()',
  },
};`;
    }).join('\n\n');

    const relSummary = det.relations.map(r => r.from + ' → ' + r.to + ' (' + r.type + ')').join(', ') || 'none';
    const entitySummary = det.entities.map(e => e.name).join(', ');
    const content = `/**
 * Database Schema — All entities
 * Generated by CSNS Smart Scaffold
 * 
 * Entities: ${entitySummary}
 * Relations: ${relSummary}
 */

${tables}
`;
    await writeFile(join(this.root, path), content);
    return path;
  }
}
