/**
 * Project Scaffold — Route-based Starter Templates
 *
 * /new ile proje oluşturulurken mimari kararlara göre
 * route → service → repo katmanlı iskelet üretir.
 * Bu iskelet Tracer/Audit tarafından trace edilebilir.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchitectureDecisions } from '../types/index.js';

export interface ScaffoldResult {
  files: string[];
  routes: string[];
}

/**
 * Mimari kararlara göre layered project scaffold üret.
 * Her zaman route → service → (repo opsiyonel) yapısında.
 */
export async function scaffoldProject(
  projectRoot: string,
  decisions: ArchitectureDecisions
): Promise<ScaffoldResult> {
  const files: string[] = [];
  const routes: string[] = [];

  // Directories
  const dirs = [
    'src', 'src/routes', 'src/services', 'src/middleware', 'src/config',
    ...(decisions.database !== 'in-memory' ? ['src/repositories', 'src/models'] : []),
    'tests',
  ];
  for (const dir of dirs) {
    await mkdir(join(projectRoot, dir), { recursive: true });
  }

  // ── src/config/index.ts ──────────────────────────────
  const configContent = `import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
${decisions.database === 'postgresql' ? "  DATABASE_URL: z.string().default('postgresql://localhost:5432/app')," : ''}
${decisions.database === 'mongodb' ? "  MONGO_URI: z.string().default('mongodb://localhost:27017/app')," : ''}
${decisions.database === 'sqlite' ? "  DB_PATH: z.string().default('./data.sqlite')," : ''}
${decisions.auth === 'jwt' ? "  JWT_SECRET: z.string().default('dev-secret-change-in-production')," : ''}
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
`;
  await writeFile(join(projectRoot, 'src/config/index.ts'), configContent);
  files.push('src/config/index.ts');

  // ── src/app.ts (Express setup) ───────────────────────
  const appContent = `import express from 'express';
${decisions.auth !== 'none' ? "import { authRouter } from './routes/auth.js';" : ''}
${decisions.auth !== 'none' ? "import { authMiddleware } from './middleware/auth.js';" : ''}
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/api.js';

export const app = express();

// Middleware
app.use(express.json());

// Public routes
app.use('/health', healthRouter);
${decisions.auth !== 'none' ? "app.use('/auth', authRouter);" : ''}

// Protected routes
${decisions.auth !== 'none' ? "app.use('/api', authMiddleware, apiRouter);" : "app.use('/api', apiRouter);"}
`;
  await writeFile(join(projectRoot, 'src/app.ts'), appContent);
  files.push('src/app.ts');

  // ── src/server.ts (entry) ────────────────────────────
  const serverContent = `import { app } from './app.js';
import { config } from './config/index.js';

app.listen(config.PORT, () => {
  console.log(\`Server listening on port \${config.PORT}\`);
});
`;
  await writeFile(join(projectRoot, 'src/server.ts'), serverContent);
  files.push('src/server.ts');

  // ── src/routes/health.ts ─────────────────────────────
  await writeFile(join(projectRoot, 'src/routes/health.ts'), `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
`);
  files.push('src/routes/health.ts');
  routes.push('GET /health');

  // ── src/routes/api.ts (main resource) ────────────────
  const apiContent = `import { Router } from 'express';
import { ResourceService } from '../services/resource-service.js';

export const apiRouter = Router();
const service = new ResourceService();

apiRouter.get('/resources', (_req, res) => {
  const items = service.findAll();
  res.json(items);
});

apiRouter.get('/resources/:id', (req, res) => {
  const item = service.findById(req.params.id!);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

apiRouter.post('/resources', (req, res) => {
  const item = service.create(req.body);
  res.status(201).json(item);
});

apiRouter.put('/resources/:id', (req, res) => {
  const item = service.update(req.params.id!, req.body);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

apiRouter.delete('/resources/:id', (req, res) => {
  const ok = service.delete(req.params.id!);
  if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(204).end();
});
`;
  await writeFile(join(projectRoot, 'src/routes/api.ts'), apiContent);
  files.push('src/routes/api.ts');
  routes.push('GET /api/resources', 'GET /api/resources/:id', 'POST /api/resources', 'PUT /api/resources/:id', 'DELETE /api/resources/:id');

  // ── src/services/resource-service.ts ─────────────────
  const serviceContent = decisions.database !== 'in-memory' ? `
import { ResourceRepository } from '../repositories/resource-repo.js';

export class ResourceService {
  private repo = new ResourceRepository();

  findAll() { return this.repo.findAll(); }
  findById(id: string) { return this.repo.findById(id); }
  create(data: Record<string, unknown>) { return this.repo.create(data); }
  update(id: string, data: Record<string, unknown>) { return this.repo.update(id, data); }
  delete(id: string) { return this.repo.delete(id); }
}
` : `
interface Resource { id: string; [key: string]: unknown; }

export class ResourceService {
  private items: Resource[] = [];
  private counter = 0;

  findAll(): Resource[] { return this.items; }

  findById(id: string): Resource | undefined {
    return this.items.find(i => i.id === id);
  }

  create(data: Record<string, unknown>): Resource {
    const item = { ...data, id: String(++this.counter) };
    this.items.push(item);
    return item;
  }

  update(id: string, data: Record<string, unknown>): Resource | undefined {
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
  await writeFile(join(projectRoot, 'src/services/resource-service.ts'), serviceContent.trim() + '\n');
  files.push('src/services/resource-service.ts');

  // ── src/repositories/resource-repo.ts (if DB) ───────
  if (decisions.database !== 'in-memory') {
    const repoContent = `/**
 * Resource Repository — data access layer
 * TODO: Replace with real ${decisions.database} queries
 */

interface Resource { id: string; [key: string]: unknown; }

export class ResourceRepository {
  private items: Resource[] = [];
  private counter = 0;

  findAll(): Resource[] { return this.items; }
  findById(id: string): Resource | undefined { return this.items.find(i => i.id === id); }
  create(data: Record<string, unknown>): Resource {
    const item = { ...data, id: String(++this.counter) };
    this.items.push(item);
    return item;
  }
  update(id: string, data: Record<string, unknown>): Resource | undefined {
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
    await writeFile(join(projectRoot, 'src/repositories/resource-repo.ts'), repoContent);
    files.push('src/repositories/resource-repo.ts');
  }

  // ── Auth routes + middleware (if auth enabled) ───────
  if (decisions.auth !== 'none') {
    // Auth route
    const authRouteContent = `import { Router } from 'express';
import { AuthService } from '../services/auth-service.js';

export const authRouter = Router();
const auth = new AuthService();

authRouter.post('/register', (req, res) => {
  const result = auth.register(req.body);
  res.status(201).json(result);
});

authRouter.post('/login', (req, res) => {
  const result = auth.login(req.body);
  if (!result) { res.status(401).json({ error: 'Invalid credentials' }); return; }
  res.json(result);
});
`;
    await writeFile(join(projectRoot, 'src/routes/auth.ts'), authRouteContent);
    files.push('src/routes/auth.ts');
    routes.push('POST /auth/register', 'POST /auth/login');

    // Auth service
    const authServiceContent = `${decisions.auth === 'jwt' ? "import { config } from '../config/index.js';" : ''}

interface User { id: string; email: string; password: string; }

export class AuthService {
  private users: User[] = [];
  private counter = 0;

  register(data: { email: string; password: string }): { id: string; email: string } {
    const user: User = { id: String(++this.counter), email: data.email, password: data.password };
    this.users.push(user);
    return { id: user.id, email: user.email };
  }

  login(data: { email: string; password: string }): { token: string } | null {
    const user = this.users.find(u => u.email === data.email && u.password === data.password);
    if (!user) return null;
    return { token: \`token-\${user.id}-\${Date.now()}\` };
  }
}
`;
    await writeFile(join(projectRoot, 'src/services/auth-service.ts'), authServiceContent);
    files.push('src/services/auth-service.ts');

    // Auth middleware
    const middlewareContent = `import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  // TODO: Validate token properly
  next();
}
`;
    await writeFile(join(projectRoot, 'src/middleware/auth.ts'), middlewareContent);
    files.push('src/middleware/auth.ts');
  }

  return { files, routes };
}
