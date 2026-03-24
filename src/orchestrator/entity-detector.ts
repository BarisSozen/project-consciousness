/**
 * Entity Detector — Brief'ten Entity, Relation, Endpoint Çıkarma
 *
 * "Todo app with users, projects, and tasks. Users can share projects."
 * →
 * entities: [User, Project, Task]
 * relations: [User↔Project (many-to-many), Project→Task (one-to-many)]
 * endpoints: [CRUD for each + share endpoint]
 */

export interface DetectedEntity {
  name: string;           // "User", "Project", "Task"
  slug: string;           // "user", "project", "task"
  pluralSlug: string;     // "users", "projects", "tasks"
  fields: EntityField[];
  isAuthEntity: boolean;  // has email/password → auth routes
}

export interface EntityField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'reference';
  required: boolean;
  reference?: string; // if type=reference, which entity
}

export interface DetectedRelation {
  from: string;     // entity name
  to: string;       // entity name
  type: 'one-to-many' | 'many-to-many' | 'one-to-one';
  throughField?: string; // "tasks" on Project, "members" on Project
}

export interface DetectedEndpoints {
  entity: string;
  routes: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    description: string;
  }>;
}

export interface EntityDetectionResult {
  entities: DetectedEntity[];
  relations: DetectedRelation[];
  endpoints: DetectedEndpoints[];
}

// ═══════════════════════════════════════════════════════════
// Keyword → Entity Patterns
// ═══════════════════════════════════════════════════════════

/** Common nouns that indicate entities */
const ENTITY_PATTERNS: Array<{
  keywords: string[];
  name: string;
  fields: EntityField[];
  isAuth: boolean;
}> = [
  {
    keywords: ['user', 'users', 'account', 'accounts', 'member', 'members', 'person', 'people'],
    name: 'User',
    fields: [
      { name: 'email', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'password', type: 'string', required: true },
      { name: 'role', type: 'string', required: false },
    ],
    isAuth: true,
  },
  {
    keywords: ['todo', 'todos', 'task', 'tasks', 'item', 'items'],
    name: 'Task',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'completed', type: 'boolean', required: false },
      { name: 'dueDate', type: 'date', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['project', 'projects', 'workspace', 'workspaces', 'board', 'boards'],
    name: 'Project',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['post', 'posts', 'article', 'articles', 'blog', 'entry', 'entries'],
    name: 'Post',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'content', type: 'string', required: true },
      { name: 'published', type: 'boolean', required: false },
      { name: 'publishedAt', type: 'date', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['comment', 'comments', 'reply', 'replies'],
    name: 'Comment',
    fields: [
      { name: 'content', type: 'string', required: true },
    ],
    isAuth: false,
  },
  {
    keywords: ['product', 'products', 'listing', 'listings'],
    name: 'Product',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'price', type: 'number', required: true },
      { name: 'stock', type: 'number', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['order', 'orders', 'purchase', 'purchases'],
    name: 'Order',
    fields: [
      { name: 'status', type: 'string', required: true },
      { name: 'total', type: 'number', required: true },
    ],
    isAuth: false,
  },
  {
    keywords: ['category', 'categories', 'tag', 'tags', 'label', 'labels'],
    name: 'Category',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'slug', type: 'string', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['message', 'messages', 'chat', 'conversation', 'conversations'],
    name: 'Message',
    fields: [
      { name: 'content', type: 'string', required: true },
      { name: 'read', type: 'boolean', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['notification', 'notifications', 'alert', 'alerts'],
    name: 'Notification',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'message', type: 'string', required: true },
      { name: 'read', type: 'boolean', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['file', 'files', 'upload', 'uploads', 'attachment', 'attachments', 'image', 'images'],
    name: 'File',
    fields: [
      { name: 'filename', type: 'string', required: true },
      { name: 'url', type: 'string', required: true },
      { name: 'size', type: 'number', required: false },
      { name: 'mimeType', type: 'string', required: false },
    ],
    isAuth: false,
  },
  {
    keywords: ['link', 'links', 'url', 'urls', 'shortener', 'redirect'],
    name: 'Link',
    fields: [
      { name: 'originalUrl', type: 'string', required: true },
      { name: 'shortCode', type: 'string', required: true },
      { name: 'clicks', type: 'number', required: false },
      { name: 'expiresAt', type: 'date', required: false },
    ],
    isAuth: false,
  },
];

/** Relation detection patterns */
const RELATION_PATTERNS: Array<{
  pattern: RegExp;
  type: DetectedRelation['type'];
}> = [
  { pattern: /(\w+)\s+(?:can\s+)?(?:have|has|contain|own|create)\s+(?:many|multiple|several)\s+(\w+)/i, type: 'one-to-many' },
  { pattern: /(\w+)\s+(?:belong|assigned)\s+to\s+(?:a|one|an)\s+(\w+)/i, type: 'one-to-many' },
  { pattern: /(\w+)\s+(?:can\s+)?(?:share|join|belong\s+to\s+many|participate)\s+(\w+)/i, type: 'many-to-many' },
  { pattern: /(\w+)\s+and\s+(\w+)\s+(?:can\s+)?(?:share|collaborate)/i, type: 'many-to-many' },
  { pattern: /each\s+(\w+)\s+has\s+(?:one|a|an)\s+(\w+)/i, type: 'one-to-one' },
];

// ═══════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════

export class EntityDetector {

  /**
   * Detect entities, relations, and endpoints from a brief description.
   */
  detect(brief: string): EntityDetectionResult {
    const briefLower = brief.toLowerCase();
    const words = briefLower.split(/[\s,.;:!?/\\()\[\]{}"'`—–-]+/).filter(w => w.length > 1);

    // 1. Detect entities
    const entities: DetectedEntity[] = [];
    const entityNames = new Set<string>();

    for (const pattern of ENTITY_PATTERNS) {
      const found = pattern.keywords.some(kw => words.includes(kw) || briefLower.includes(kw));
      if (found && !entityNames.has(pattern.name)) {
        entityNames.add(pattern.name);
        entities.push({
          name: pattern.name,
          slug: pattern.name.toLowerCase(),
          pluralSlug: this.pluralize(pattern.name.toLowerCase()),
          fields: [...pattern.fields],
          isAuthEntity: pattern.isAuth,
        });
      }
    }

    // If no entities detected, create a generic "Resource"
    if (entities.length === 0) {
      entities.push({
        name: 'Resource',
        slug: 'resource',
        pluralSlug: 'resources',
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'description', type: 'string', required: false },
        ],
        isAuthEntity: false,
      });
    }

    // 2. Detect relations
    const relations = this.detectRelations(brief, entities);

    // 3. Add ownership relations (User → everything, if User exists)
    const userEntity = entities.find(e => e.isAuthEntity);
    if (userEntity) {
      for (const entity of entities) {
        if (entity.isAuthEntity) continue;
        const exists = relations.some(r =>
          (r.from === userEntity.name && r.to === entity.name) ||
          (r.from === entity.name && r.to === userEntity.name)
        );
        if (!exists) {
          relations.push({
            from: userEntity.name,
            to: entity.name,
            type: 'one-to-many',
          });
          // Add userId reference field
          entity.fields.push({
            name: 'userId',
            type: 'reference',
            required: true,
            reference: userEntity.name,
          });
        }
      }
    }

    // 4. Generate endpoints
    const endpoints = this.generateEndpoints(entities, relations);

    return { entities, relations, endpoints };
  }

  private detectRelations(brief: string, entities: DetectedEntity[]): DetectedRelation[] {
    const relations: DetectedRelation[] = [];
    const entityNames = entities.map(e => e.name.toLowerCase());

    for (const rp of RELATION_PATTERNS) {
      const match = brief.match(rp.pattern);
      if (match) {
        const from = this.matchEntityName(match[1] ?? '', entityNames, entities);
        const to = this.matchEntityName(match[2] ?? '', entityNames, entities);
        if (from && to && from !== to) {
          const exists = relations.some(r => r.from === from && r.to === to);
          if (!exists) {
            relations.push({ from, to, type: rp.type });
          }
        }
      }
    }

    // Detect parent-child from "X's Y" or "Y of X" patterns
    const possessivePattern = /(\w+)(?:'s|s')\s+(\w+)/gi;
    let match: RegExpExecArray | null;
    while ((match = possessivePattern.exec(brief)) !== null) {
      const from = this.matchEntityName(match[1] ?? '', entityNames, entities);
      const to = this.matchEntityName(match[2] ?? '', entityNames, entities);
      if (from && to && from !== to) {
        const exists = relations.some(r => r.from === from && r.to === to);
        if (!exists) {
          relations.push({ from, to, type: 'one-to-many' });
        }
      }
    }

    return relations;
  }

  private generateEndpoints(entities: DetectedEntity[], relations: DetectedRelation[]): DetectedEndpoints[] {
    const endpoints: DetectedEndpoints[] = [];

    for (const entity of entities) {
      const routes: DetectedEndpoints['routes'] = [];
      const base = `/${entity.pluralSlug}`;

      if (entity.isAuthEntity) {
        routes.push(
          { method: 'POST', path: '/auth/register', description: `Register new ${entity.slug}` },
          { method: 'POST', path: '/auth/login', description: `Login ${entity.slug}` },
          { method: 'GET', path: '/auth/me', description: `Get current ${entity.slug}` },
        );
      }

      // CRUD
      routes.push(
        { method: 'GET', path: base, description: `List all ${entity.pluralSlug}` },
        { method: 'GET', path: `${base}/:id`, description: `Get ${entity.slug} by ID` },
        { method: 'POST', path: base, description: `Create ${entity.slug}` },
        { method: 'PUT', path: `${base}/:id`, description: `Update ${entity.slug}` },
        { method: 'DELETE', path: `${base}/:id`, description: `Delete ${entity.slug}` },
      );

      // Relation-based endpoints
      for (const rel of relations) {
        if (rel.from === entity.name) {
          const childEntity = entities.find(e => e.name === rel.to);
          if (childEntity) {
            routes.push({
              method: 'GET',
              path: `${base}/:id/${childEntity.pluralSlug}`,
              description: `List ${childEntity.pluralSlug} for ${entity.slug}`,
            });
          }
        }
        if (rel.type === 'many-to-many' && rel.to === entity.name) {
          const parentEntity = entities.find(e => e.name === rel.from);
          if (parentEntity) {
            routes.push(
              { method: 'POST', path: `${base}/:id/${parentEntity.pluralSlug}/:${parentEntity.slug}Id`, description: `Add ${parentEntity.slug} to ${entity.slug}` },
              { method: 'DELETE', path: `${base}/:id/${parentEntity.pluralSlug}/:${parentEntity.slug}Id`, description: `Remove ${parentEntity.slug} from ${entity.slug}` },
            );
          }
        }
      }

      endpoints.push({ entity: entity.name, routes });
    }

    return endpoints;
  }

  private matchEntityName(word: string, _entityNames: string[], entities: DetectedEntity[]): string | null {
    const lower = word.toLowerCase();
    // Direct match
    const direct = entities.find(e => e.slug === lower || e.pluralSlug === lower);
    if (direct) return direct.name;
    // Fuzzy — check if word starts with entity name
    const fuzzy = entities.find(e => lower.startsWith(e.slug) || e.slug.startsWith(lower));
    if (fuzzy) return fuzzy.name;
    return null;
  }

  private pluralize(word: string): string {
    if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') || word.endsWith('ch') || word.endsWith('sh')) return word + 'es';
    return word + 's';
  }
}
