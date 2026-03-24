/**
 * Reverse Engineer — Codebase Audit via Architecture Recovery
 *
 * Mevcut bir kodu tersine mühendislik ile analiz eder:
 * 1. Katman tespiti: hangi dosya controller, service, repo, model, util?
 * 2. Data flow zinciri: request → middleware → controller → service → repo → response
 * 3. Mimari tutarlılık: ARCHITECTURE.md'deki kararlar kodda uygulanmış mı?
 * 4. Karar arkeolojisi: DECISIONS.md'deki kararlar gerçekten var mı?
 * 5. Pattern tespiti: hangi design pattern'ler kullanılmış, tutarlı mı?
 *
 * Tracer Agent'ın static + runtime verisini alıp üzerine semantic katman ekler.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type { LLMProvider } from '../../llm/types.js';
import type {
  DependencyEdge,
  ExportNode,
  ImportEdge,
} from '../../types/index.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type ArchLayer = 
  | 'controller' | 'route' | 'middleware' | 'service' 
  | 'repository' | 'model' | 'schema' | 'util' | 'config' 
  | 'test' | 'migration' | 'entry' | 'type' | 'unknown';

export interface FileClassification {
  file: string;
  layer: ArchLayer;
  confidence: number;      // 0-1
  signals: string[];       // why this classification
  exports: string[];
}

export interface DataFlowChain {
  id: string;
  trigger: string;          // "POST /auth/register", "GET /todos"
  steps: DataFlowNode[];
  complete: boolean;        // does the chain end at a response?
  gaps: string[];           // missing links
}

export interface DataFlowNode {
  order: number;
  layer: ArchLayer;
  file: string;
  symbol: string;           // function/class name
  operation: string;        // "validate input", "query DB", "transform response"
  dataShape?: string;       // "{ email, password } → { userId, token }"
}

export interface ArchitectureViolation {
  type: 'layer-skip' | 'wrong-direction' | 'decision-missing' | 'decision-contradicted' | 'pattern-inconsistency' | 'coupling-violation';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  file: string;
  evidence: string;
  expectedBehavior: string;
  /** If the violation matches a known architectural pattern or explicit decision, it's acknowledged — not a bug */
  acknowledged: boolean;
  acknowledgeReason?: string;
}

export interface DecisionAuditResult {
  decisionId: string;
  title: string;
  status: 'implemented' | 'partially-implemented' | 'not-found' | 'contradicted';
  evidence: string[];
  files: string[];
}

export interface AuditReport {
  /** File → layer classification */
  classifications: FileClassification[];
  /** End-to-end data flow chains */
  dataFlows: DataFlowChain[];
  /** Architecture violations */
  violations: ArchitectureViolation[];
  /** Decision audit results */
  decisionAudit: DecisionAuditResult[];
  /** Detected patterns */
  patterns: DetectedPattern[];
  /** Summary stats */
  summary: {
    totalFiles: number;
    layerDistribution: Record<ArchLayer, number>;
    totalFlows: number;
    completeFlows: number;
    incompleteFlows: number;
    violationCount: number;
    decisionsImplemented: number;
    decisionsTotal: number;
    healthScore: number;     // 0-100
  };
}

export interface DetectedPattern {
  name: string;             // "Repository Pattern", "Middleware Chain", "Factory"
  files: string[];
  confidence: number;
}

// ═══════════════════════════════════════════════════════════
// Regex Pattern Libraries
// ═══════════════════════════════════════════════════════════

/** Layer classification signals from file path */
const PATH_SIGNALS: Array<{ pattern: RegExp; layer: ArchLayer; weight: number }> = [
  { pattern: /\broute[sr]?\b/i, layer: 'route', weight: 8 },
  { pattern: /\bcontroller[s]?\b/i, layer: 'controller', weight: 8 },
  { pattern: /\bresolver[s]?\b/i, layer: 'controller', weight: 9 },     // GraphQL resolvers = controller layer
  { pattern: /\bmutation[s]?\b/i, layer: 'controller', weight: 7 },     // GraphQL mutations
  { pattern: /\bquer(?:y|ies)\b/i, layer: 'controller', weight: 5 },    // GraphQL queries (low weight — ambiguous)
  { pattern: /\bgateway\b/i, layer: 'route', weight: 8 },               // API gateway = route layer
  { pattern: /\bmiddleware[s]?\b/i, layer: 'middleware', weight: 9 },
  { pattern: /\bservice[s]?\b/i, layer: 'service', weight: 8 },
  { pattern: /\brepo(?:sitor(?:y|ies))?\b/i, layer: 'repository', weight: 8 },
  { pattern: /\bdal\b/i, layer: 'repository', weight: 7 },
  { pattern: /\bmodel[s]?\b/i, layer: 'model', weight: 7 },
  { pattern: /\bentit(?:y|ies)\b/i, layer: 'model', weight: 7 },
  { pattern: /\bschema[s]?\b/i, layer: 'schema', weight: 7 },
  { pattern: /\bvalidat(?:or|ion)[s]?\b/i, layer: 'schema', weight: 6 },
  { pattern: /\butil[s]?\b|\bhelper[s]?\b|\blib\b/i, layer: 'util', weight: 8 },
  { pattern: /\bconfig\b|\bsettings?\b|\benv\b/i, layer: 'config', weight: 7 },
  { pattern: /\btest[s]?\b|\bspec[s]?\b|__tests__/i, layer: 'test', weight: 9 },
  { pattern: /\bmigrat(?:ion|e)[s]?\b|\bseed[s]?\b/i, layer: 'migration', weight: 8 },
  { pattern: /\btype[s]?\b|\binterface[s]?\b|\bd\.ts$/i, layer: 'type', weight: 7 },
  { pattern: /\bcomponent[s]?\b/i, layer: 'controller', weight: 4 },    // React components (low — UI layer)
  { pattern: /\bhook[s]?\b/i, layer: 'service', weight: 5 },            // React hooks = service-like
  { pattern: /\bprovider[s]?\b/i, layer: 'middleware', weight: 5 },     // React providers = middleware-like
  { pattern: /\bpage[s]?\b|\/app\//i, layer: 'route', weight: 5 },      // Next.js pages/app = route
  { pattern: /\bstore[s]?\b/i, layer: 'service', weight: 7 },           // State stores (Zustand, Redux) = service
  { pattern: /\bapi\b/i, layer: 'service', weight: 5 },                 // API client modules = service-like
  { pattern: /\b(tabs)\b|\(.*\)\//i, layer: 'route', weight: 7 },       // Expo Router group routes: (tabs), (auth)
  { pattern: /\bindex\.(ts|js)$/, layer: 'entry', weight: 3 },
];

/** Content signals for layer classification */
const CONTENT_SIGNALS: Array<{ pattern: RegExp; layer: ArchLayer; weight: number; signal: string }> = [
  // Route/Controller — REST
  { pattern: /Router\(\)|app\.(get|post|put|delete|patch|use)\s*\(/, layer: 'route', weight: 7, signal: 'Express router/app usage' },
  { pattern: /\@(Get|Post|Put|Delete|Patch|Controller)\(/, layer: 'controller', weight: 8, signal: 'Decorator-based controller' },
  { pattern: /req\s*,\s*res\s*[,)]|request\s*,\s*response/, layer: 'controller', weight: 5, signal: 'req/res handler signature' },

  // Route/Controller — GraphQL
  { pattern: /\bResolver\b|\bresolvers?\s*[:=]\s*{/, layer: 'controller', weight: 8, signal: 'GraphQL resolver definition' },
  { pattern: /\bMutation\b.*[:=]\s*{|\bmutations?\s*[:=]\s*{/i, layer: 'controller', weight: 7, signal: 'GraphQL mutation resolver' },
  { pattern: /\bQuery\b.*[:=]\s*{|\bqueries\s*[:=]\s*{/i, layer: 'controller', weight: 7, signal: 'GraphQL query resolver' },
  { pattern: /\bSubscription\b.*[:=]\s*{/, layer: 'controller', weight: 7, signal: 'GraphQL subscription resolver' },
  { pattern: /buildSubgraphSchema|ApolloServer|ApolloGateway/i, layer: 'route', weight: 9, signal: 'Apollo server/gateway setup' },
  { pattern: /gql\s*`|typeDefs|#graphql/, layer: 'schema', weight: 7, signal: 'GraphQL schema/typeDefs definition' },
  { pattern: /__resolveReference|@key\(fields:/, layer: 'controller', weight: 8, signal: 'Apollo federation entity resolver' },

  // Route — API Gateway / Federation
  { pattern: /supergraph|IntrospectAndCompose|RemoteGraphQLDataSource/i, layer: 'route', weight: 9, signal: 'Apollo federation gateway' },
  { pattern: /createProxyMiddleware|http-proxy-middleware/i, layer: 'route', weight: 8, signal: 'Proxy/gateway routing' },

  // Middleware
  { pattern: /\(req,\s*res,\s*next\)|\(req:\s*Request.*next:\s*NextFunction\)/, layer: 'middleware', weight: 8, signal: 'next() middleware signature' },
  { pattern: /authenticate|authorize|guard|protect/, layer: 'middleware', weight: 5, signal: 'Auth-related naming' },
  { pattern: /correlat(?:ion)?[-_]?id|x-request-id/i, layer: 'util', weight: 6, signal: 'Correlation/request ID utility' },

  // Service
  { pattern: /class\s+\w+Service\b/, layer: 'service', weight: 8, signal: 'Service class naming' },
  { pattern: /async\s+\w+\(.*\).*Promise</, layer: 'service', weight: 2, signal: 'Async method' },

  // Repository/DAL
  { pattern: /class\s+\w+Repo(?:sitory)?\b/, layer: 'repository', weight: 8, signal: 'Repository class naming' },
  { pattern: /\.find(?:One|Many|All|By)\b|\.create\b|\.update\b|\.delete\b|\.save\b/, layer: 'repository', weight: 3, signal: 'CRUD methods' },
  { pattern: /SELECT\s|INSERT\s|UPDATE\s|DELETE\s|FROM\s/i, layer: 'repository', weight: 7, signal: 'Raw SQL' },
  { pattern: /prisma\.|drizzle\.|knex\.|sequelize\.|mongoose\./, layer: 'repository', weight: 8, signal: 'ORM usage' },

  // Model/Entity
  { pattern: /class\s+\w+(?:Entity|Model)\b/, layer: 'model', weight: 8, signal: 'Entity/Model class naming' },
  { pattern: /\@Entity\(|\@Table\(|\@Column\(/, layer: 'model', weight: 9, signal: 'ORM decorators' },

  // Schema/Validation
  { pattern: /z\.object\(|z\.string\(|z\.number\(/, layer: 'schema', weight: 8, signal: 'Zod schema' },
  { pattern: /Joi\.|yup\.|ajv\b/, layer: 'schema', weight: 7, signal: 'Validation library' },

  // Config
  { pattern: /process\.env\[|dotenv|\.config\(\)/, layer: 'config', weight: 5, signal: 'Env variable access' },
  { pattern: /export\s+(?:const|let)\s+(?:config|settings|options)\s*=/, layer: 'config', weight: 6, signal: 'Config export' },

  // React/Frontend components
  { pattern: /export\s+(?:default\s+)?function\s+\w+.*\)\s*{\s*return\s*[(<]|React\.FC|JSX\.Element/, layer: 'controller', weight: 4, signal: 'React component' },
  { pattern: /use[A-Z]\w+\s*\(|useState|useEffect|useCallback|useMemo/, layer: 'service', weight: 4, signal: 'React hook (service-like)' },

  // State management (Zustand, Redux, MobX)
  { pattern: /create\s*\(\s*\(?set|zustand|useStore|configureStore|createSlice/, layer: 'service', weight: 8, signal: 'State store (Zustand/Redux)' },

  // API client modules
  { pattern: /useMutation|useQuery|graphqlClient|fetchGraphQL|gql\s*`/, layer: 'service', weight: 6, signal: 'API/GraphQL client' },

  // Expo Router pages
  { pattern: /export\s+default\s+function\s+\w+.*Screen|export\s+default\s+function\s+\w+.*Page/, layer: 'route', weight: 7, signal: 'Screen/Page component (Expo/RN)' },
];

/** Architecture decision keywords to search in code */
const DECISION_EVIDENCE_PATTERNS: Record<string, RegExp[]> = {
  'jwt': [/jsonwebtoken|jwt\.sign|jwt\.verify|Bearer\s/i, /JwtStrategy|passport-jwt/i],
  'session': [/express-session|cookie-session|req\.session/i],
  'oauth': [/passport-google|passport-github|OAuth2Client/i],
  'postgresql': [/pg\b|postgres|PG_|DATABASE_URL.*postgres/i, /prisma.*postgresql|drizzle.*pg/i],
  'mongodb': [/mongoose|MongoClient|mongodb:\/\//i],
  'sqlite': [/better-sqlite3|sqlite3|\.sqlite\b/i],
  'rest': [/Router\(\)|app\.(get|post|put|delete)\(/i],
  'graphql': [/graphql|apollo|type\s+Query\s*{|gql`/i],
  'trpc': [/createTRPCRouter|initTRPC|tRPC/i],
  'react': [/import.*from\s+['"]react['"]/i, /jsx|tsx|useState|useEffect/i],
  'nextjs': [/next\/|getServerSideProps|getStaticProps|app\/.*page\.tsx/i],
  'docker': [/Dockerfile|docker-compose|DOCKER_/i],
};

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

// ═══════════════════════════════════════════════════════════
// Main Class
// ═══════════════════════════════════════════════════════════

export class ReverseEngineer {
  private projectRoot: string;
  private provider: LLMProvider | null;

  constructor(projectRoot: string, provider?: LLMProvider | null) {
    this.projectRoot = projectRoot;
    this.provider = provider ?? null;
  }

  /**
   * Full reverse engineering audit.
   * Uses static graph data from StaticAnalyzer if provided,
   * otherwise builds its own.
   */
  async audit(
    _imports?: ImportEdge[],
    _exports?: ExportNode[],
    edges?: DependencyEdge[],
    memoryFiles?: { mission?: string; architecture?: string; decisions?: string }
  ): Promise<AuditReport> {
    // 1. Collect all source files
    const files = await this.collectFiles();
    const fileContents = await this.readFiles(files);

    // 2. Classify every file into architectural layers
    const classifications = await this.classifyFiles(files, fileContents);

    // 3. Trace data flow chains
    const dataFlows = this.traceDataFlows(classifications, fileContents, _imports, edges);

    // 4. Detect patterns (before violations — patterns inform acknowledgement)
    const patterns = this.detectPatterns(classifications, fileContents);

    // 5. Detect architecture violations (pattern-aware + architecture-aware)
    const violations = this.detectViolations(classifications, edges ?? [], dataFlows, patterns, memoryFiles?.architecture);

    // 6. Audit decisions against actual code
    const decisionAudit = this.auditDecisions(
      memoryFiles?.decisions ?? '',
      memoryFiles?.architecture ?? '',
      fileContents
    );

    // 7. LLM deep audit (optional)
    let llmViolations: ArchitectureViolation[] = [];
    if (this.provider) {
      llmViolations = await this.llmDeepAudit(classifications, dataFlows, memoryFiles);
      violations.push(...llmViolations);
    }

    // 8. Compute summary
    const summary = this.computeSummary(classifications, dataFlows, violations, decisionAudit);

    return { classifications, dataFlows, violations, decisionAudit, patterns, summary };
  }

  // ═══════════════════════════════════════════════════════════
  // Layer Classification
  // ═══════════════════════════════════════════════════════════

  private async classifyFiles(
    files: string[],
    contents: Map<string, string>
  ): Promise<FileClassification[]> {
    const results: FileClassification[] = [];

    for (const file of files) {
      const content = contents.get(file) ?? '';
      const scores = new Map<ArchLayer, { score: number; signals: string[] }>();

      // Path-based signals
      for (const { pattern, layer, weight } of PATH_SIGNALS) {
        if (pattern.test(file)) {
          const entry = scores.get(layer) ?? { score: 0, signals: [] };
          entry.score += weight;
          entry.signals.push(`path: ${pattern.source}`);
          scores.set(layer, entry);
        }
      }

      // Content-based signals
      for (const { pattern, layer, weight, signal } of CONTENT_SIGNALS) {
        if (pattern.test(content)) {
          const entry = scores.get(layer) ?? { score: 0, signals: [] };
          entry.score += weight;
          entry.signals.push(signal);
          scores.set(layer, entry);
        }
      }

      // Find winning layer
      let bestLayer: ArchLayer = 'unknown';
      let bestScore = 0;
      let bestSignals: string[] = [];

      for (const [layer, { score, signals }] of scores) {
        if (score > bestScore) {
          bestLayer = layer;
          bestScore = score;
          bestSignals = signals;
        }
      }

      // Extract exports
      const exportNames = this.extractExportNames(content);

      const maxPossible = 20; // rough max score
      results.push({
        file,
        layer: bestLayer,
        confidence: Math.min(bestScore / maxPossible, 1),
        signals: bestSignals,
        exports: exportNames,
      });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // Data Flow Tracing
  // ═══════════════════════════════════════════════════════════

  private traceDataFlows(
    classifications: FileClassification[],
    contents: Map<string, string>,
    _imports?: ImportEdge[],
    edges?: DependencyEdge[]
  ): DataFlowChain[] {
    const chains: DataFlowChain[] = [];

    // Find all route definitions as entry points
    const routeFiles = classifications.filter(c =>
      c.layer === 'route' || c.layer === 'controller'
    );

    for (const routeFile of routeFiles) {
      const content = contents.get(routeFile.file) ?? '';

      // REST: app.get('/path', handler) or router.post('/path', ...)
      const routeRegex = /\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;
      let match: RegExpExecArray | null;

      while ((match = routeRegex.exec(content)) !== null) {
        const method = match[1]!.toUpperCase();
        const path = match[2]!;
        const trigger = `${method} ${path}`;

        const chain = this.buildChainFromRoute(
          trigger, routeFile, classifications, contents, edges ?? []
        );
        chains.push(chain);
      }

      // GraphQL: Query/Mutation resolver objects — only match actual code blocks, not comments
      // Pattern: const resolvers = { Query: { users: async () => ... }, Mutation: { ... } }
      const strippedContent = this.stripComments(content);
      const gqlResolverBlockRegex = /(?:Query|Mutation)\s*:\s*{([^}]{5,})}/gs;
      let gqlMatch: RegExpExecArray | null;
      while ((gqlMatch = gqlResolverBlockRegex.exec(strippedContent)) !== null) {
        const block = gqlMatch[0];
        const isQuery = /^Query\s*:/m.test(block);
        // Extract actual resolver function names (word followed by : or ( at start of line/after comma)
        const resolverNameRegex = /(?:^|,)\s*(\w+)\s*(?::\s*(?:async\s*)?\(|[\(:])/gm;
        let rnMatch: RegExpExecArray | null;
        while ((rnMatch = resolverNameRegex.exec(gqlMatch[1]!)) !== null) {
          const name = rnMatch[1]!;
          if (['async', 'return', 'const', 'let', 'var', 'function', 'if', 'else', 'try', 'catch'].includes(name)) continue;
          if (name.length < 2) continue;
          const trigger = `${isQuery ? 'Query' : 'Mutation'} ${name}`;
          const chain = this.buildChainFromRoute(
            trigger, routeFile, classifications, contents, edges ?? []
          );
          chains.push(chain);
        }
      }

      // GraphQL: exported resolver functions — export async function getUsers(parent, args, ctx)
      const exportedResolverRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*(?:parent|root|_)\s*,\s*(?:args|_)/g;
      while ((match = exportedResolverRegex.exec(strippedContent)) !== null) {
        const name = match[1]!;
        const trigger = `Resolver ${name}`;
        const chain = this.buildChainFromRoute(
          trigger, routeFile, classifications, contents, edges ?? []
        );
        chains.push(chain);
      }
    }

    return chains;
  }

  private buildChainFromRoute(
    trigger: string,
    routeFile: FileClassification,
    classifications: FileClassification[],
    contents: Map<string, string>,
    edges: DependencyEdge[]
  ): DataFlowChain {
    const steps: DataFlowNode[] = [];
    const gaps: string[] = [];
    let order = 0;

    // Step 1: Route handler
    steps.push({
      order: order++,
      layer: routeFile.layer,
      file: routeFile.file,
      symbol: trigger,
      operation: 'receive request, dispatch to handler',
    });

    // Step 2: Follow imports from route file → find services, repos
    const routeImports = edges.filter(e => e.source === routeFile.file);

    // Find service layer
    const serviceEdge = routeImports.find(e => {
      const target = classifications.find(c => c.file === e.target);
      return target?.layer === 'service';
    });

    if (serviceEdge) {
      const serviceContent = contents.get(serviceEdge.target) ?? '';
      steps.push({
        order: order++,
        layer: 'service',
        file: serviceEdge.target,
        symbol: serviceEdge.symbols.join(', '),
        operation: this.inferOperation(serviceContent, trigger),
      });

      // Step 3: Follow service → repo/model
      const serviceImports = edges.filter(e => e.source === serviceEdge.target);
      const repoEdge = serviceImports.find(e => {
        const target = classifications.find(c => c.file === e.target);
        return target?.layer === 'repository' || target?.layer === 'model';
      });

      if (repoEdge) {
        steps.push({
          order: order++,
          layer: classifications.find(c => c.file === repoEdge.target)?.layer ?? 'repository',
          file: repoEdge.target,
          symbol: repoEdge.symbols.join(', '),
          operation: 'data access / persistence',
        });
      } else {
        gaps.push('Service has no repository/model dependency — data access layer missing or inline');
      }
    } else {
      // Controller might directly use repo (layer skip)
      const directRepo = routeImports.find(e => {
        const target = classifications.find(c => c.file === e.target);
        return target?.layer === 'repository' || target?.layer === 'model';
      });

      if (directRepo) {
        steps.push({
          order: order++,
          layer: classifications.find(c => c.file === directRepo.target)?.layer ?? 'repository',
          file: directRepo.target,
          symbol: directRepo.symbols.join(', '),
          operation: 'direct data access (no service layer)',
        });
        gaps.push('Controller accesses repository directly — service layer skipped');
      } else {
        gaps.push('Route handler has no service or repository imports — logic is likely inline');
      }
    }

    // Middleware detection
    const middlewareEdge = routeImports.find(e => {
      const target = classifications.find(c => c.file === e.target);
      return target?.layer === 'middleware';
    });
    if (middlewareEdge) {
      // Insert middleware as step 1 (before service)
      steps.splice(1, 0, {
        order: 0,
        layer: 'middleware',
        file: middlewareEdge.target,
        symbol: middlewareEdge.symbols.join(', '),
        operation: 'pre-processing (auth, validation, etc.)',
      });
      // Reorder
      steps.forEach((s, i) => s.order = i);
    }

    // Schema/validation detection
    const schemaEdge = routeImports.find(e => {
      const target = classifications.find(c => c.file === e.target);
      return target?.layer === 'schema';
    });
    if (schemaEdge) {
      steps.splice(middlewareEdge ? 2 : 1, 0, {
        order: 0,
        layer: 'schema',
        file: schemaEdge.target,
        symbol: schemaEdge.symbols.join(', '),
        operation: 'input validation',
      });
      steps.forEach((s, i) => s.order = i);
    }

    return {
      id: `flow-${trigger.replace(/\s+/g, '-').toLowerCase()}`,
      trigger,
      steps,
      complete: gaps.length === 0,
      gaps,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Architecture Violation Detection
  // ═══════════════════════════════════════════════════════════

  private detectViolations(
    classifications: FileClassification[],
    edges: DependencyEdge[],
    dataFlows: DataFlowChain[],
    detectedPatterns?: DetectedPattern[],
    architecture?: string
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];

    // Pre-compute: is this a GraphQL project? (adjusts expectations)
    const isGraphQL = (detectedPatterns ?? []).some(p =>
      p.name === 'GraphQL Resolvers' || p.name === 'GraphQL Federation'
    );
    // Pre-compute: has explicit "no service layer" decision?
    const archLower = (architecture ?? '').toLowerCase();
    const hasNoServiceDecision = archLower.includes('no service layer') ||
      archLower.includes('thin resolver') ||
      archLower.includes('resolver-first') ||
      archLower.includes('direct db');

    // 1. Layer skip: controller → repository (skipping service)
    for (const flow of dataFlows) {
      // Skip flows from test files
      const flowFile = flow.steps[0]?.file ?? '';
      if (this.isTestFile(flowFile)) continue;

      // Skip health/ready/live/metrics endpoints — intentionally minimal
      if (this.isInfraEndpoint(flow.trigger)) continue;

      if (flow.gaps.some(g => g.includes('service layer skipped'))) {
        // Acknowledge if GraphQL project or explicit decision
        const acknowledged = isGraphQL || hasNoServiceDecision;
        violations.push({
          type: 'layer-skip',
          severity: acknowledged ? 'info' : 'warning',
          description: `${flow.trigger}: controller accesses repository directly, service layer skipped`,
          file: flowFile,
          evidence: flow.gaps.join('; '),
          expectedBehavior: 'Controller → Service → Repository (3-tier architecture)',
          acknowledged,
          acknowledgeReason: acknowledged
            ? (isGraphQL ? 'GraphQL resolver pattern — direct DB access is common in resolver-first architecture' : 'Explicit architectural decision')
            : undefined,
        });
      }
    }

    // 2. Wrong direction: lower layer imports higher layer
    const layerOrder: ArchLayer[] = ['route', 'controller', 'middleware', 'service', 'repository', 'model'];
    for (const edge of edges) {
      if (edge.typeOnly) continue;

      const sourceClass = classifications.find(c => c.file === edge.source);
      const targetClass = classifications.find(c => c.file === edge.target);
      if (!sourceClass || !targetClass) continue;

      // Skip: test, util, type, config, entry point, migration — they import freely
      if (this.isExemptLayer(sourceClass.layer) || this.isExemptLayer(targetClass.layer)) continue;
      if (this.isEntryPointFile(edge.source)) continue;
      // Also skip by filename — test files sometimes misclassified by content
      if (this.isTestFile(edge.source) || this.isTestFile(edge.target)) continue;

      // Skip React component cross-imports — components importing components is normal
      if (edge.source.includes('component') && edge.target.includes('component')) continue;

      const sourceIdx = layerOrder.indexOf(sourceClass.layer);
      const targetIdx = layerOrder.indexOf(targetClass.layer);

      if (sourceIdx >= 0 && targetIdx >= 0 && sourceIdx > targetIdx && targetIdx < sourceIdx - 1) {
        violations.push({
          type: 'wrong-direction',
          severity: 'warning',
          description: `${sourceClass.layer} (${edge.source}) imports ${targetClass.layer} (${edge.target}) — dependency flows upward`,
          file: edge.source,
          evidence: `import { ${edge.symbols.join(', ')} } from '${edge.target}'`,
          expectedBehavior: 'Dependencies should flow downward: controller → service → repository',
          acknowledged: false,
        });
      }
    }

    // 3. Incomplete data flows
    for (const flow of dataFlows) {
      const flowFile = flow.steps[0]?.file ?? '';
      if (this.isTestFile(flowFile)) continue;
      if (this.isInfraEndpoint(flow.trigger)) continue;

      if (!flow.complete) {
        // "inline logic" in GraphQL resolvers is common — acknowledge
        const isInlineResolver = isGraphQL && flow.gaps.some(g => g.includes('inline'));
        violations.push({
          type: 'coupling-violation',
          severity: 'info',
          description: `${flow.trigger}: data flow chain is incomplete`,
          file: flowFile,
          evidence: flow.gaps.join('; '),
          expectedBehavior: 'Complete chain: route → middleware → service → repository → response',
          acknowledged: isInlineResolver,
          acknowledgeReason: isInlineResolver ? 'GraphQL resolver with inline logic — common in resolver-first pattern' : undefined,
        });
      }
    }

    // 4. Pattern inconsistency
    const nonInfraFlows = dataFlows.filter(f =>
      !this.isInfraEndpoint(f.trigger) && !this.isTestFile(f.steps[0]?.file ?? '')
    );
    const routesWithService = nonInfraFlows.filter(f => f.steps.some(s => s.layer === 'service'));
    const routesWithoutService = nonInfraFlows.filter(f => !f.steps.some(s => s.layer === 'service') && f.steps.length > 1);
    if (routesWithService.length > 0 && routesWithoutService.length > 0) {
      const ratio = routesWithService.length / (routesWithService.length + routesWithoutService.length);
      // If most routes don't use service (>80%), it's probably a conscious choice
      const acknowledged = ratio < 0.2 || hasNoServiceDecision;
      violations.push({
        type: 'pattern-inconsistency',
        severity: acknowledged ? 'info' : 'warning',
        description: `Mixed patterns: ${routesWithService.length} routes use service layer, ${routesWithoutService.length} don't`,
        file: 'project-wide',
        evidence: `Without service: ${routesWithoutService.slice(0, 10).map(f => f.trigger).join(', ')}${routesWithoutService.length > 10 ? ` ... +${routesWithoutService.length - 10} more` : ''}`,
        expectedBehavior: 'All routes should consistently use (or not use) a service layer',
        acknowledged,
        acknowledgeReason: acknowledged ? 'Majority pattern is resolver-first without service layer — accepted as project convention' : undefined,
      });
    }

    return violations;
  }

  // ── Violation Helper Predicates ─────────────────────────────

  /** Health, ready, live, metrics — infra endpoints, not business logic */
  private isInfraEndpoint(trigger: string): boolean {
    const lower = trigger.toLowerCase();
    return /^\w+\s+\/?(health|ready|live|metrics|favicon|robots)\b/.test(lower) ||
      /^\w+\s+\/$/.test(lower);
  }

  /** Test files should not produce violations */
  private isTestFile(file: string): boolean {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) ||
      /__tests__\//.test(file) ||
      /\btest[s]?\//.test(file) ||
      /\._patches\//.test(file);
  }

  /** Entry point files (index.ts, server.ts, app.ts) legitimately import everything */
  private isEntryPointFile(file: string): boolean {
    return /(?:^|\/)(?:index|server|app|main)\.(ts|js)$/.test(file);
  }

  /** Layers that are exempt from wrong-direction checks */
  private isExemptLayer(layer: ArchLayer): boolean {
    return layer === 'test' || layer === 'util' || layer === 'type' ||
      layer === 'config' || layer === 'entry' || layer === 'migration' || layer === 'unknown';
  }

  // ═══════════════════════════════════════════════════════════
  // Decision Archaeology
  // ═══════════════════════════════════════════════════════════

  private auditDecisions(
    decisionsContent: string,
    architectureContent: string,
    fileContents: Map<string, string>
  ): DecisionAuditResult[] {
    const results: DecisionAuditResult[] = [];

    // Parse decisions from DECISIONS.md
    const decisionBlocks = decisionsContent.split(/(?=## D\d{3})/).filter(d => /^## D\d{3}/.test(d));

    for (const block of decisionBlocks) {
      const idMatch = block.match(/## (D\d{3})\s*[—–-]\s*(.+)/);
      if (!idMatch) continue;

      const id = idMatch[1]!;
      const title = idMatch[2]!.trim();

      // Find keywords from decision title and body
      const keywords = this.extractDecisionKeywords(title, block);
      const evidence: string[] = [];
      const files: string[] = [];

      for (const [file, content] of fileContents) {
        for (const keyword of keywords) {
          if (content.toLowerCase().includes(keyword.toLowerCase())) {
            evidence.push(`${file}: contains "${keyword}"`);
            if (!files.includes(file)) files.push(file);
          }
        }
      }

      let status: DecisionAuditResult['status'] = 'not-found';
      if (evidence.length >= 3) status = 'implemented';
      else if (evidence.length >= 1) status = 'partially-implemented';

      results.push({ decisionId: id, title, status, evidence: evidence.slice(0, 10), files });
    }

    // Parse architecture decisions
    const archDecisions = this.extractArchDecisions(architectureContent);
    for (const [key, value] of archDecisions) {
      const patterns = DECISION_EVIDENCE_PATTERNS[value.toLowerCase()];
      if (!patterns) continue;

      const evidence: string[] = [];
      const files: string[] = [];

      for (const [file, content] of fileContents) {
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            evidence.push(`${file}: matches ${pattern.source.slice(0, 50)}`);
            if (!files.includes(file)) files.push(file);
          }
        }
      }

      // Check for contradictions — e.g., ARCHITECTURE says JWT but code uses session
      const contradictions = this.findContradictions(key, value, fileContents);

      let status: DecisionAuditResult['status'] = evidence.length > 0 ? 'implemented' : 'not-found';
      if (contradictions.length > 0) status = 'contradicted';

      results.push({
        decisionId: `ARCH-${key}`,
        title: `${key}: ${value}`,
        status,
        evidence: [...evidence.slice(0, 5), ...contradictions.map(c => `⚠️ CONTRADICTION: ${c}`)],
        files,
      });
    }

    return results;
  }

  private findContradictions(
    key: string,
    value: string,
    fileContents: Map<string, string>
  ): string[] {
    const contradictions: string[] = [];
    const allCode = [...fileContents.entries()];

    // Auth contradictions
    if (key === 'auth' || key === 'Auth') {
      const alternatives: Record<string, RegExp[]> = {
        'jwt': [/express-session|cookie-session|req\.session/],
        'session': [/jsonwebtoken|jwt\.sign|jwt\.verify/],
        'none': [/jsonwebtoken|passport|express-session/],
      };
      const contras = alternatives[value.toLowerCase()];
      if (contras) {
        for (const [file, content] of allCode) {
          for (const pattern of contras) {
            if (pattern.test(content)) {
              contradictions.push(`${file} uses ${pattern.source.slice(0, 40)} but ARCHITECTURE says ${key}: ${value}`);
            }
          }
        }
      }
    }

    // Database contradictions
    if (key === 'database' || key === 'Database') {
      const alternatives: Record<string, RegExp[]> = {
        'postgresql': [/mongoose|MongoClient|mongodb/i, /better-sqlite3|sqlite3/i],
        'mongodb': [/pg\b|postgres|PG_/i, /better-sqlite3|sqlite3/i],
        'sqlite': [/mongoose|MongoClient|mongodb/i, /pg\b|postgres|PG_/i],
        'in-memory': [/pg\b|postgres|mongoose|MongoClient|sqlite/i],
      };
      const contras = alternatives[value.toLowerCase()];
      if (contras) {
        for (const [file, content] of allCode) {
          for (const pattern of contras) {
            if (pattern.test(content)) {
              contradictions.push(`${file} uses ${pattern.source.slice(0, 40)} but ARCHITECTURE says ${key}: ${value}`);
            }
          }
        }
      }
    }

    return contradictions;
  }

  // ═══════════════════════════════════════════════════════════
  // Pattern Detection
  // ═══════════════════════════════════════════════════════════

  private detectPatterns(
    classifications: FileClassification[],
    contents: Map<string, string>
  ): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const allCode = [...contents.values()].join('\n');

    // Repository pattern
    const repoFiles = classifications.filter(c => c.layer === 'repository');
    if (repoFiles.length > 0) {
      patterns.push({ name: 'Repository Pattern', files: repoFiles.map(f => f.file), confidence: 0.9 });
    }

    // Service layer pattern
    const serviceFiles = classifications.filter(c => c.layer === 'service');
    if (serviceFiles.length > 0) {
      patterns.push({ name: 'Service Layer', files: serviceFiles.map(f => f.file), confidence: 0.9 });
    }

    // Middleware chain
    const middlewareFiles = classifications.filter(c => c.layer === 'middleware');
    if (middlewareFiles.length > 0) {
      patterns.push({ name: 'Middleware Chain', files: middlewareFiles.map(f => f.file), confidence: 0.8 });
    }

    // Factory pattern
    if (/create\w+\(|factory|Factory/.test(allCode)) {
      const factoryFiles = [...contents.entries()]
        .filter(([_, c]) => /create\w+\(|class\s+\w+Factory/.test(c))
        .map(([f]) => f);
      if (factoryFiles.length > 0) {
        patterns.push({ name: 'Factory Pattern', files: factoryFiles, confidence: 0.7 });
      }
    }

    // Singleton pattern
    if (/(?:let|const)\s+instance\b|getInstance\(\)/.test(allCode)) {
      const singletonFiles = [...contents.entries()]
        .filter(([_, c]) => /getInstance\(\)|private\s+static\s+instance/.test(c))
        .map(([f]) => f);
      if (singletonFiles.length > 0) {
        patterns.push({ name: 'Singleton Pattern', files: singletonFiles, confidence: 0.8 });
      }
    }

    // Dependency injection
    if (/constructor\s*\(\s*(?:private|readonly)/.test(allCode)) {
      const diFiles = [...contents.entries()]
        .filter(([_, c]) => /constructor\s*\(\s*(?:private|readonly)\s+\w+:\s+\w+/.test(c))
        .map(([f]) => f);
      if (diFiles.length > 1) {
        patterns.push({ name: 'Constructor Injection', files: diFiles, confidence: 0.7 });
      }
    }

    // GraphQL Federation
    if (/buildSubgraphSchema|ApolloGateway|IntrospectAndCompose|__resolveReference/.test(allCode)) {
      const fedFiles = [...contents.entries()]
        .filter(([_, c]) => /buildSubgraphSchema|ApolloGateway|IntrospectAndCompose|__resolveReference|@key\(fields:/.test(c))
        .map(([f]) => f);
      if (fedFiles.length > 0) {
        patterns.push({ name: 'GraphQL Federation', files: fedFiles, confidence: 0.9 });
      }
    }

    // GraphQL Resolvers
    if (/(?:Query|Mutation|Subscription)\s*[:=]\s*{/.test(allCode)) {
      const resolverFiles = [...contents.entries()]
        .filter(([_, c]) => /(?:Query|Mutation|Subscription)\s*[:=]\s*{/.test(c))
        .map(([f]) => f);
      if (resolverFiles.length > 0) {
        patterns.push({ name: 'GraphQL Resolvers', files: resolverFiles, confidence: 0.9 });
      }
    }

    // Event-Driven / Pub-Sub
    if (/publish\(|subscribe\(|emit\(|EventEmitter|on\(['"]/.test(allCode)) {
      const eventFiles = [...contents.entries()]
        .filter(([_, c]) => /class\s+\w+(?:Publisher|Subscriber|EventBus)|\.publish\(|\.subscribe\(/.test(c))
        .map(([f]) => f);
      if (eventFiles.length > 0) {
        patterns.push({ name: 'Event-Driven / Pub-Sub', files: eventFiles, confidence: 0.7 });
      }
    }

    // Circuit Breaker
    if (/circuit[-_]?breaker|CircuitBreaker|breaker\.fire/i.test(allCode)) {
      const cbFiles = [...contents.entries()]
        .filter(([_, c]) => /circuit[-_]?breaker|CircuitBreaker/i.test(c))
        .map(([f]) => f);
      if (cbFiles.length > 0) {
        patterns.push({ name: 'Circuit Breaker', files: cbFiles, confidence: 0.8 });
      }
    }

    return patterns;
  }

  // ═══════════════════════════════════════════════════════════
  // LLM Deep Audit
  // ═══════════════════════════════════════════════════════════

  private async llmDeepAudit(
    classifications: FileClassification[],
    dataFlows: DataFlowChain[],
    memoryFiles?: { mission?: string; architecture?: string; decisions?: string }
  ): Promise<ArchitectureViolation[]> {
    if (!this.provider) return [];

    const classificationSummary = classifications
      .filter(c => c.layer !== 'test' && c.layer !== 'type')
      .map(c => `${c.file} → ${c.layer} (${(c.confidence * 100).toFixed(0)}%)`)
      .join('\n');

    const flowSummary = dataFlows
      .map(f => `${f.trigger}: ${f.steps.map(s => `${s.layer}(${s.file})`).join(' → ')}${f.complete ? '' : ' [INCOMPLETE]'}`)
      .join('\n');

    const prompt = `You are auditing a codebase for architectural consistency.

## File Classifications
${classificationSummary}

## Data Flow Chains
${flowSummary}

${memoryFiles?.architecture ? `## ARCHITECTURE.md\n${memoryFiles.architecture.slice(0, 2000)}` : ''}
${memoryFiles?.decisions ? `## DECISIONS.md (recent)\n${memoryFiles.decisions.slice(-2000)}` : ''}
${memoryFiles?.mission ? `## MISSION.md\n${memoryFiles.mission.slice(0, 1000)}` : ''}

Identify architectural violations. Return JSON array:
[{
  "type": "layer-skip|wrong-direction|decision-missing|decision-contradicted|pattern-inconsistency|coupling-violation",
  "severity": "critical|warning|info",
  "description": "...",
  "file": "...",
  "evidence": "...",
  "expectedBehavior": "..."
}]

Only report issues you're confident about. Empty array if none found.`;

    try {
      const response = await this.provider.chat(
        [{ role: 'user', content: prompt }],
        { system: 'You are a software architecture auditor. Report only real violations with evidence.', maxTokens: 4096 }
      );

      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as ArchitectureViolation[];
      return parsed.filter(v => v.type && v.description && v.file);
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Summary Computation
  // ═══════════════════════════════════════════════════════════

  private computeSummary(
    classifications: FileClassification[],
    dataFlows: DataFlowChain[],
    violations: ArchitectureViolation[],
    decisionAudit: DecisionAuditResult[]
  ): AuditReport['summary'] {
    const layerDist = {} as Record<ArchLayer, number>;
    for (const c of classifications) {
      layerDist[c.layer] = (layerDist[c.layer] ?? 0) + 1;
    }

    const decisionsImpl = decisionAudit.filter(d => d.status === 'implemented').length;
    const completeFlows = dataFlows.filter(f => f.complete).length;

    // Health score: 100 base, subtract for UNACKNOWLEDGED issues — scaled by project size
    const fileCount = classifications.filter(c => c.layer !== 'test' && c.layer !== 'type').length;
    const scaleFactor = Math.max(1, Math.log10(fileCount || 1));
    
    // Only unacknowledged violations count against health
    const realViolations = violations.filter(v => !v.acknowledged);
    
    let health = 100;
    health -= realViolations.filter(v => v.severity === 'critical').length * (10 / scaleFactor);
    health -= realViolations.filter(v => v.severity === 'warning').length * (3 / scaleFactor);
    health -= realViolations.filter(v => v.severity === 'info').length * (0.5 / scaleFactor);
    health -= decisionAudit.filter(d => d.status === 'contradicted').length * 15;
    health -= decisionAudit.filter(d => d.status === 'not-found').length * 3;
    const incompleteRatio = dataFlows.length > 0
      ? (dataFlows.length - completeFlows) / dataFlows.length
      : 0;
    health -= Math.round(incompleteRatio * 15);

    return {
      totalFiles: classifications.length,
      layerDistribution: layerDist,
      totalFlows: dataFlows.length,
      completeFlows,
      incompleteFlows: dataFlows.length - completeFlows,
      violationCount: violations.length,
      decisionsImplemented: decisionsImpl,
      decisionsTotal: decisionAudit.length,
      healthScore: Math.max(0, Math.min(100, health)),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private async collectFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walk(this.projectRoot, files);
    return files;
  }

  private async walk(dir: string, files: string[]): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await this.walk(join(dir, entry.name), files);
      } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name).toLowerCase())) {
        files.push(relative(this.projectRoot, join(dir, entry.name)).replace(/\\/g, '/'));
      }
    }
  }

  private async readFiles(files: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const file of files) {
      try {
        map.set(file, await readFile(join(this.projectRoot, file), 'utf-8'));
      } catch { /* skip unreadable */ }
    }
    return map;
  }

  private extractExportNames(content: string): string[] {
    const exports: string[] = [];
    const regex = /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      if (m[1]) exports.push(m[1]);
    }
    return exports;
  }

  private extractDecisionKeywords(title: string, block: string): string[] {
    // Extract meaningful words from decision title and body
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
      'might', 'shall', 'can', 'need', 'must', 'for', 'and', 'nor', 'but', 'or', 'yet', 'so',
      'at', 'by', 'in', 'of', 'on', 'to', 'with', 'from', 'up', 'about', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'this', 'that', 'these', 'those',
      'bir', 've', 'ile', 'için', 'olan', 'olarak', 'bu', 'şu', 'karar', 'tarih', 'durum', 'active']);

    const words = (title + ' ' + block)
      .split(/[\s,.;:!?/\\()\[\]{}"'`—–-]+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 3 && !stopWords.has(w) && !/^\d+$/.test(w));

    return [...new Set(words)].slice(0, 15);
  }

  private extractArchDecisions(architecture: string): Map<string, string> {
    const decisions = new Map<string, string>();
    // Parse "**Key**: value" pattern from architecture
    const regex = /\*\*(\w+)\*\*:\s*(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(architecture)) !== null) {
      if (m[1] && m[2]) decisions.set(m[1], m[2]);
    }
    return decisions;
  }

  private inferOperation(content: string, trigger: string): string {
    const lower = content.toLowerCase();
    if (trigger.startsWith('POST') && (lower.includes('create') || lower.includes('insert'))) return 'create resource';
    if (trigger.startsWith('GET') && (lower.includes('findall') || lower.includes('list') || lower.includes('getall'))) return 'list resources';
    if (trigger.startsWith('GET') && (lower.includes('findone') || lower.includes('getby'))) return 'get single resource';
    if (trigger.startsWith('PUT') || trigger.startsWith('PATCH')) return 'update resource';
    if (trigger.startsWith('DELETE')) return 'delete resource';
    if (lower.includes('login') || lower.includes('auth')) return 'authenticate';
    if (lower.includes('register') || lower.includes('signup')) return 'register user';
    return 'business logic';
  }

  /** Strip single-line and multi-line comments from source */
  private stripComments(content: string): string {
    // Remove block comments
    let result = content.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line comments
    result = result.replace(/\/\/.*$/gm, '');
    // Remove JSDoc asterisk lines
    result = result.replace(/^\s*\*.*$/gm, '');
    return result;
  }
}
