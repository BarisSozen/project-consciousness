/**
 * Specialist Router — Task → Domain-Specific Agent Routing
 *
 * Generic "coder" yerine task'ı analiz edip doğru uzmana yönlendirir.
 * Her uzman:
 * 1. Sadece ilgili dosyaları context'e alır (token tasarrufu)
 * 2. Kendi tool setini kullanır (domain-specific)
 * 3. Kendi validation'ını çalıştırır (domain-specific checks)
 *
 * Uzmanlar:
 * - SecurityCoder: auth, middleware, encryption, JWT, RBAC
 * - APICoder: routes, controllers, endpoints, validation
 * - DataCoder: schemas, repositories, migrations, queries
 * - InfraCoder: config, env, Docker, CI/CD, deploy
 * - SecurityReviewer: OWASP check, CVE scan, security scanner
 * - ArchitectReviewer: layer check, pattern consistency, decision compliance
 * - PerfReviewer: N+1, unbounded queries, sync I/O, memory leaks
 */

import type { TaskDefinition, MemorySnapshot, MemoryFiles } from '../types/index.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type SpecialistDomain =
  | 'security' | 'api' | 'data' | 'infra' | 'frontend'
  | 'security-review' | 'architecture-review' | 'perf-review'
  | 'general';

export interface SpecialistProfile {
  domain: SpecialistDomain;
  /** System prompt — domain expertise */
  persona: string;
  /** Which file patterns to include in context */
  contextPatterns: RegExp[];
  /** Which memory sections to include (reduces token waste) */
  memorySlice: (keyof MemoryFiles)[];
  /** Which memory subsections to extract (regex on content) */
  memorySections?: RegExp[];
  /** Post-execution validation checks */
  validationChecks: string[];
  /** Tools this specialist should use */
  tools: string[];
}

export interface RoutingDecision {
  primary: SpecialistDomain;
  secondary?: SpecialistDomain;
  reviewer: SpecialistDomain;
  confidence: number;
  reason: string;
}

export interface FocusedContext {
  domain: SpecialistDomain;
  memorySlice: string;  // trimmed memory (only relevant sections)
  relevantFiles: string[];
  tokenEstimate: number;
}

// ═══════════════════════════════════════════════════════════
// Specialist Profiles
// ═══════════════════════════════════════════════════════════

const SPECIALISTS: Record<SpecialistDomain, SpecialistProfile> = {
  security: {
    domain: 'security',
    persona: `You are a security-focused software engineer specializing in authentication, authorization, and cryptography.
Your code must follow OWASP guidelines. Every auth flow must be fail-closed.
Validate all inputs. Never trust client data. Hash passwords with bcrypt/argon2. Use parameterized queries only.
JWT: always verify algorithm, set expiry, use separate refresh tokens. Never log secrets.`,
    contextPatterns: [
      /auth/i, /middleware/i, /guard/i, /permission/i, /rbac/i, /role/i,
      /password/i, /token/i, /jwt/i, /session/i, /crypto/i, /encrypt/i,
      /secret/i, /credential/i, /oauth/i, /login/i, /register/i,
    ],
    memorySlice: ['mission', 'architecture'],
    memorySections: [/auth/i, /security/i, /permission/i, /jwt/i, /session/i],
    validationChecks: ['security-scanner', 'tsc'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },

  api: {
    domain: 'api',
    persona: `You are an API engineer specializing in REST/GraphQL endpoint design.
Every route must have input validation (Zod/Joi). Every response must have proper status codes.
Error responses must be consistent ({ error: string }). Use middleware for cross-cutting concerns.
Document endpoints with JSDoc. Handle edge cases: 404, 409, 422. Never expose internal errors.`,
    contextPatterns: [
      /route/i, /controller/i, /handler/i, /endpoint/i, /api/i,
      /resolver/i, /mutation/i, /query/i, /schema/i, /validat/i,
    ],
    memorySlice: ['mission', 'architecture'],
    memorySections: [/api/i, /endpoint/i, /route/i, /rest/i, /graphql/i],
    validationChecks: ['tsc', 'smoke-test'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },

  data: {
    domain: 'data',
    persona: `You are a data layer engineer specializing in database design and data access.
Always use parameterized queries. Design schemas with proper constraints (NOT NULL, UNIQUE, FK).
Use transactions for multi-table writes. Add indexes for frequently queried columns.
Repository pattern: keep SQL out of business logic. Handle connection pooling.`,
    contextPatterns: [
      /repo/i, /repository/i, /database/i, /schema/i, /model/i, /entity/i,
      /migration/i, /seed/i, /query/i, /sql/i, /drizzle/i, /prisma/i,
      /db/i, /pool/i, /transaction/i,
    ],
    memorySlice: ['mission', 'architecture'],
    memorySections: [/database/i, /schema/i, /data/i, /storage/i],
    validationChecks: ['tsc', 'security-scanner'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },

  infra: {
    domain: 'infra',
    persona: `You are a DevOps/infrastructure engineer.
Config must come from environment variables with validation at startup.
Docker: multi-stage builds, non-root user, .dockerignore. CI: test → lint → security → build.
Never hardcode secrets. Use health check endpoints. Handle graceful shutdown.`,
    contextPatterns: [
      /config/i, /env/i, /docker/i, /deploy/i, /ci/i, /workflow/i,
      /infra/i, /server\.ts/i, /health/i, /startup/i,
    ],
    memorySlice: ['architecture', 'state'],
    memorySections: [/deploy/i, /config/i, /infra/i, /docker/i],
    validationChecks: ['tsc', 'env-completeness'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },

  frontend: {
    domain: 'frontend',
    persona: `You are a frontend engineer specializing in React/Next.js.
Components must be pure and composable. Use hooks for logic, components for rendering.
Handle loading/error/empty states. Validate props. Use proper TypeScript types.
Accessibility: semantic HTML, ARIA labels, keyboard navigation.`,
    contextPatterns: [
      /component/i, /page/i, /hook/i, /context/i, /provider/i, /layout/i,
      /style/i, /css/i, /tailwind/i, /ui/i, /view/i, /app\//i,
    ],
    memorySlice: ['mission', 'architecture'],
    memorySections: [/frontend/i, /ui/i, /component/i, /design/i],
    validationChecks: ['tsc'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },

  'security-review': {
    domain: 'security-review',
    persona: `You are a security auditor. Review code against OWASP Top 10.
Check: injection, broken auth, sensitive data exposure, XXE, broken access control,
security misconfiguration, XSS, insecure deserialization, known vulnerabilities, insufficient logging.`,
    contextPatterns: [/auth/i, /middleware/i, /route/i, /config/i, /env/i],
    memorySlice: ['mission', 'architecture', 'decisions'],
    validationChecks: ['security-scanner', 'cve-scanner'],
    tools: ['Read'],
  },

  'architecture-review': {
    domain: 'architecture-review',
    persona: `You are a software architect. Review code for architectural consistency.
Check: layer violations, dependency direction, pattern consistency, decision compliance,
separation of concerns, single responsibility, interface contracts.`,
    contextPatterns: [/.*/], // reads everything
    memorySlice: ['mission', 'architecture', 'decisions'],
    validationChecks: ['architecture-audit', 'tsc'],
    tools: ['Read'],
  },

  'perf-review': {
    domain: 'perf-review',
    persona: `You are a performance engineer. Review code for performance issues.
Check: N+1 queries, unbounded selects, sync I/O, memory leaks, missing indexes,
unnecessary re-renders, bundle size, connection pool config.`,
    contextPatterns: [/route/i, /service/i, /repo/i, /query/i, /handler/i],
    memorySlice: ['architecture'],
    validationChecks: ['performance-budget'],
    tools: ['Read'],
  },

  general: {
    domain: 'general',
    persona: `You are an experienced software engineer. Write clean, tested, maintainable code.
Follow the project's existing patterns. Don't expand scope beyond the task.`,
    contextPatterns: [/.*/],
    memorySlice: ['mission', 'architecture', 'decisions', 'state'],
    validationChecks: ['tsc'],
    tools: ['Write', 'Read', 'Edit', 'Bash'],
  },
};

// ═══════════════════════════════════════════════════════════
// Task Analysis → Domain Keywords
// ═══════════════════════════════════════════════════════════

const DOMAIN_KEYWORDS: Record<SpecialistDomain, string[]> = {
  security: ['auth', 'login', 'register', 'password', 'jwt', 'token', 'session', 'permission', 'rbac', 'role', 'encrypt', 'secret', 'oauth', 'middleware', 'guard', 'csrf', 'cors', 'xss'],
  api: ['route', 'endpoint', 'controller', 'handler', 'rest', 'graphql', 'resolver', 'mutation', 'query', 'crud', 'api', 'request', 'response', 'validation'],
  data: ['database', 'schema', 'model', 'repository', 'migration', 'query', 'sql', 'table', 'column', 'index', 'seed', 'orm', 'drizzle', 'prisma', 'mongo'],
  infra: ['docker', 'deploy', 'ci', 'cd', 'config', 'env', 'environment', 'health', 'monitoring', 'logging', 'infrastructure', 'nginx', 'server', 'startup'],
  frontend: ['component', 'page', 'ui', 'frontend', 'react', 'next', 'hook', 'state', 'style', 'css', 'tailwind', 'layout', 'form', 'button', 'modal'],
  'security-review': ['review security', 'audit security', 'vulnerability', 'penetration'],
  'architecture-review': ['review architecture', 'audit architecture', 'layer', 'pattern'],
  'perf-review': ['performance', 'optimize', 'slow', 'n+1', 'memory', 'leak', 'profil'],
  general: [],
};

// ═══════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════

export class SpecialistRouter {

  /**
   * Analyze a task and determine which specialist should handle it.
   */
  route(task: TaskDefinition): RoutingDecision {
    const taskText = `${task.title} ${task.description} ${task.type}`.toLowerCase();
    const scores = new Map<SpecialistDomain, number>();

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (taskText.includes(kw)) score += 1;
      }
      // Boost by task type
      if (task.type === 'review' && domain.includes('review')) score += 3;
      if (task.type === 'code' && !domain.includes('review')) score += 1;
      if (task.type === 'test') score += (domain === 'general' ? 2 : 0);

      if (score > 0) scores.set(domain as SpecialistDomain, score);
    }

    // Sort by score
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const primary = sorted[0]?.[0] ?? 'general';
    const secondary = sorted[1]?.[0];
    const primaryScore = sorted[0]?.[1] ?? 0;

    // Choose reviewer based on primary
    let reviewer: SpecialistDomain = 'architecture-review';
    if (primary === 'security' || primary === 'api') reviewer = 'security-review';
    if (primary === 'data' || primary === 'api') reviewer = 'perf-review';

    return {
      primary,
      secondary: secondary !== primary ? secondary : undefined,
      reviewer,
      confidence: Math.min(primaryScore / 5, 1),
      reason: `Task matches ${primary} domain (score: ${primaryScore})`,
    };
  }

  /**
   * Get the specialist profile for a domain.
   */
  getProfile(domain: SpecialistDomain): SpecialistProfile {
    return SPECIALISTS[domain];
  }

  /**
   * Build focused context for a specialist — only relevant files and memory sections.
   */
  buildFocusedContext(
    domain: SpecialistDomain,
    memory: MemorySnapshot,
    allFiles: string[]
  ): FocusedContext {
    const profile = SPECIALISTS[domain];

    // 1. Filter memory — only relevant sections
    const memoryParts: string[] = [];
    for (const key of profile.memorySlice) {
      let content = memory.files[key];

      // If memorySections defined, extract only matching sections
      if (profile.memorySections && profile.memorySections.length > 0) {
        const sections: string[] = [];
        const lines = content.split('\n');
        let capturing = false;
        let currentSection: string[] = [];

        for (const line of lines) {
          if (line.startsWith('## ')) {
            if (capturing && currentSection.length > 0) {
              sections.push(currentSection.join('\n'));
            }
            capturing = profile.memorySections.some(rx => rx.test(line));
            currentSection = capturing ? [line] : [];
          } else if (capturing) {
            currentSection.push(line);
          }
        }
        if (capturing && currentSection.length > 0) {
          sections.push(currentSection.join('\n'));
        }

        content = sections.length > 0 ? sections.join('\n\n') : content.slice(0, 500); // fallback: first 500 chars
      }

      memoryParts.push(`### ${key.toUpperCase()}\n${content}`);
    }

    const memorySlice = memoryParts.join('\n\n');

    // 2. Filter files — only relevant to this domain
    const relevantFiles = allFiles.filter(file =>
      profile.contextPatterns.some(rx => rx.test(file))
    );

    // 3. Estimate tokens
    const tokenEstimate = Math.ceil(memorySlice.length / 4) + relevantFiles.length * 200;

    return { domain, memorySlice, relevantFiles, tokenEstimate };
  }

  /**
   * Get all available specialist domains.
   */
  listSpecialists(): Array<{ domain: SpecialistDomain; description: string }> {
    return [
      { domain: 'security', description: 'Auth, JWT, encryption, RBAC, middleware' },
      { domain: 'api', description: 'Routes, controllers, endpoints, validation' },
      { domain: 'data', description: 'Schemas, repositories, migrations, queries' },
      { domain: 'infra', description: 'Config, Docker, CI/CD, deploy, monitoring' },
      { domain: 'frontend', description: 'Components, hooks, styles, layouts' },
      { domain: 'security-review', description: 'OWASP audit, CVE check, vulnerability scan' },
      { domain: 'architecture-review', description: 'Layer check, pattern consistency, decision compliance' },
      { domain: 'perf-review', description: 'N+1 queries, unbounded selects, sync I/O, memory leaks' },
      { domain: 'general', description: 'General-purpose coding tasks' },
    ];
  }
}
