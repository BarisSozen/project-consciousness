/**
 * Stack-based Phase Templates
 *
 * Her stack için varsayılan fazlar + keyword'lerle tetiklenen ekstra fazlar.
 * LLM gerektirmez — brief'teki anahtar kelimelerle eşleşme yapar.
 */

import type { ProjectPhase, StackType } from '../types/index.js';

// ── Feature Detection Keywords ──────────────────────────────

export interface FeatureDetector {
  name: string;
  keywords: string[];
  phase: Omit<ProjectPhase, 'id' | 'dependsOn'>;
}

/**
 * Brief'ten tespit edilebilecek yaygın feature'lar.
 * Her biri eşleşirse plana ekstra faz olarak eklenir.
 */
export const FEATURE_DETECTORS: FeatureDetector[] = [
  {
    name: 'auth',
    keywords: ['auth', 'login', 'signup', 'register', 'jwt', 'oauth', 'session', 'password', 'kimlik', 'giriş', 'oturum'],
    phase: {
      name: 'Authentication & Authorization',
      description: 'Kullanıcı kimlik doğrulama, yetkilendirme ve oturum yönetimi',
      tasks: [
        { id: '', title: 'Auth model & schema', type: 'create', targetFiles: ['src/models/user.ts', 'src/schemas/auth.ts'] },
        { id: '', title: 'Auth service (register/login/refresh)', type: 'create', targetFiles: ['src/services/auth-service.ts'] },
        { id: '', title: 'Auth middleware (JWT/session)', type: 'create', targetFiles: ['src/middleware/auth.ts'] },
        { id: '', title: 'Auth tests', type: 'test', targetFiles: ['tests/auth.test.ts'] },
      ],
      acceptanceCriteria: ['Register/login/logout çalışıyor', 'Token refresh mekanizması var', 'Yetkisiz erişim engelleniyor'],
      estimatedFiles: ['src/models/user.ts', 'src/services/auth-service.ts', 'src/middleware/auth.ts'],
    },
  },
  {
    name: 'database',
    keywords: ['database', 'db', 'postgres', 'mysql', 'mongo', 'prisma', 'drizzle', 'sequelize', 'migration', 'veritabanı', 'sql', 'redis', 'sqlite'],
    phase: {
      name: 'Database & Data Layer',
      description: 'Veritabanı bağlantısı, schema tanımları ve migration sistemi',
      tasks: [
        { id: '', title: 'Database connection & config', type: 'config', targetFiles: ['src/config/database.ts'] },
        { id: '', title: 'Schema / migration tanımları', type: 'create', targetFiles: ['src/db/schema.ts'] },
        { id: '', title: 'Repository layer', type: 'create', targetFiles: ['src/repositories/'] },
      ],
      acceptanceCriteria: ['Database bağlantısı çalışıyor', 'Migration sistemi hazır', 'CRUD operasyonları test edildi'],
      estimatedFiles: ['src/config/database.ts', 'src/db/schema.ts'],
    },
  },
  {
    name: 'api',
    keywords: ['api', 'rest', 'graphql', 'endpoint', 'route', 'controller', 'grpc', 'websocket', 'socket'],
    phase: {
      name: 'API Layer',
      description: 'API endpoint tanımları, request/response handling, validation',
      tasks: [
        { id: '', title: 'Route/endpoint tanımları', type: 'create', targetFiles: ['src/routes/'] },
        { id: '', title: 'Request validation (schema)', type: 'create', targetFiles: ['src/schemas/'] },
        { id: '', title: 'Error handling middleware', type: 'create', targetFiles: ['src/middleware/error-handler.ts'] },
        { id: '', title: 'API tests', type: 'test', targetFiles: ['tests/api/'] },
      ],
      acceptanceCriteria: ['Tüm endpoint\'ler çalışıyor', 'Input validation aktif', 'Error response\'lar tutarlı'],
      estimatedFiles: ['src/routes/', 'src/middleware/error-handler.ts'],
    },
  },
  {
    name: 'frontend',
    keywords: ['frontend', 'ui', 'react', 'vue', 'svelte', 'next', 'nuxt', 'component', 'page', 'dashboard', 'landing', 'arayüz'],
    phase: {
      name: 'Frontend & UI',
      description: 'Kullanıcı arayüzü, component\'ler, routing ve state management',
      tasks: [
        { id: '', title: 'Layout & routing yapısı', type: 'create', targetFiles: ['src/app/layout.tsx', 'src/app/page.tsx'] },
        { id: '', title: 'Core component\'ler', type: 'create', targetFiles: ['src/components/'] },
        { id: '', title: 'State management', type: 'create', targetFiles: ['src/store/'] },
        { id: '', title: 'Styling & theme', type: 'config', targetFiles: ['tailwind.config.ts', 'src/styles/'] },
      ],
      acceptanceCriteria: ['Sayfalar render ediliyor', 'Responsive tasarım çalışıyor', 'State yönetimi tutarlı'],
      estimatedFiles: ['src/app/', 'src/components/', 'src/store/'],
    },
  },
  {
    name: 'blockchain',
    keywords: ['blockchain', 'web3', 'smart contract', 'solidity', 'ethereum', 'evm', 'wallet', 'token', 'nft', 'defi', 'swap', 'dex', 'bridge', 'viem', 'wagmi', 'ethers'],
    phase: {
      name: 'Blockchain & Web3 Integration',
      description: 'Smart contract etkileşimi, wallet bağlantısı, on-chain veri okuma/yazma',
      tasks: [
        { id: '', title: 'Contract ABI & client setup', type: 'config', targetFiles: ['src/contracts/', 'src/config/chains.ts'] },
        { id: '', title: 'Wallet connection', type: 'create', targetFiles: ['src/lib/wallet.ts'] },
        { id: '', title: 'On-chain service layer', type: 'create', targetFiles: ['src/services/blockchain-service.ts'] },
      ],
      acceptanceCriteria: ['Wallet bağlantısı çalışıyor', 'Contract çağrıları başarılı', 'Chain switching destekleniyor'],
      estimatedFiles: ['src/contracts/', 'src/lib/wallet.ts'],
    },
  },
  {
    name: 'realtime',
    keywords: ['realtime', 'real-time', 'websocket', 'socket.io', 'sse', 'push', 'notification', 'live', 'stream', 'chat', 'canlı'],
    phase: {
      name: 'Real-time Communication',
      description: 'WebSocket/SSE bağlantısı, event yönetimi, canlı veri akışı',
      tasks: [
        { id: '', title: 'WebSocket server/client setup', type: 'create', targetFiles: ['src/lib/socket.ts'] },
        { id: '', title: 'Event handler\'lar', type: 'create', targetFiles: ['src/events/'] },
        { id: '', title: 'Real-time tests', type: 'test', targetFiles: ['tests/realtime.test.ts'] },
      ],
      acceptanceCriteria: ['Bağlantı kurulup korunuyor', 'Event\'ler doğru iletiliyor', 'Reconnect mekanizması var'],
      estimatedFiles: ['src/lib/socket.ts', 'src/events/'],
    },
  },
  {
    name: 'payments',
    keywords: ['payment', 'stripe', 'billing', 'subscription', 'checkout', 'ödeme', 'fatura', 'abonelik'],
    phase: {
      name: 'Payment Integration',
      description: 'Ödeme sistemi entegrasyonu, abonelik yönetimi, webhook handling',
      tasks: [
        { id: '', title: 'Payment provider setup', type: 'config', targetFiles: ['src/config/payment.ts'] },
        { id: '', title: 'Payment service', type: 'create', targetFiles: ['src/services/payment-service.ts'] },
        { id: '', title: 'Webhook handler', type: 'create', targetFiles: ['src/webhooks/payment.ts'] },
      ],
      acceptanceCriteria: ['Ödeme akışı çalışıyor', 'Webhook\'lar doğru işleniyor', 'İptal/iade destekleniyor'],
      estimatedFiles: ['src/services/payment-service.ts', 'src/webhooks/payment.ts'],
    },
  },
  {
    name: 'deploy',
    keywords: ['deploy', 'docker', 'kubernetes', 'k8s', 'ci/cd', 'github actions', 'vercel', 'aws', 'gcp', 'azure', 'terraform', 'nginx'],
    phase: {
      name: 'Deployment & Infrastructure',
      description: 'Container yapılandırması, CI/CD pipeline, deploy scriptleri',
      tasks: [
        { id: '', title: 'Dockerfile & compose', type: 'config', targetFiles: ['Dockerfile', 'docker-compose.yml'] },
        { id: '', title: 'CI/CD pipeline', type: 'config', targetFiles: ['.github/workflows/ci.yml'] },
        { id: '', title: 'Environment config', type: 'config', targetFiles: ['.env.example', 'src/config/env.ts'] },
      ],
      acceptanceCriteria: ['Docker build başarılı', 'CI pipeline yeşil', 'Env değişkenleri dokümante edildi'],
      estimatedFiles: ['Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml'],
    },
  },
];

// ── Stack Base Templates ────────────────────────────────────

type BaseTemplate = Array<Omit<ProjectPhase, 'id' | 'dependsOn'>>;

const NODE_BASE: BaseTemplate = [
  {
    name: 'Project Setup',
    description: 'Proje iskeleti, package.json, tsconfig, linter, formatter',
    tasks: [
      { id: '', title: 'package.json & tsconfig', type: 'config', targetFiles: ['package.json', 'tsconfig.json'] },
      { id: '', title: 'Linter & formatter', type: 'config', targetFiles: ['.eslintrc.json', '.prettierrc'] },
      { id: '', title: 'Entry point', type: 'create', targetFiles: ['src/index.ts'] },
    ],
    acceptanceCriteria: ['npm install çalışıyor', 'TypeScript derlenebiliyor', 'Lint hatasız'],
    estimatedFiles: ['package.json', 'tsconfig.json', 'src/index.ts'],
  },
  {
    name: 'Core Business Logic',
    description: 'Domain modelleri, servis katmanı, temel iş mantığı',
    tasks: [
      { id: '', title: 'Domain modelleri & tipleri', type: 'create', targetFiles: ['src/types/'] },
      { id: '', title: 'Service layer', type: 'create', targetFiles: ['src/services/'] },
      { id: '', title: 'Unit tests', type: 'test', targetFiles: ['tests/services/'] },
    ],
    acceptanceCriteria: ['Core modeller tanımlı', 'Servisler test edildi', 'İş kuralları doğru'],
    estimatedFiles: ['src/types/', 'src/services/'],
  },
];

const REACT_BASE: BaseTemplate = [
  {
    name: 'Project Setup',
    description: 'React/Next.js projesi, Tailwind CSS, temel yapılandırma',
    tasks: [
      { id: '', title: 'Next.js / Vite init', type: 'config', targetFiles: ['package.json', 'next.config.js'] },
      { id: '', title: 'Tailwind & theme setup', type: 'config', targetFiles: ['tailwind.config.ts', 'src/styles/globals.css'] },
      { id: '', title: 'Layout & providers', type: 'create', targetFiles: ['src/app/layout.tsx', 'src/providers/'] },
    ],
    acceptanceCriteria: ['Dev server başlıyor', 'Tailwind stilleri çalışıyor', 'Base layout render ediliyor'],
    estimatedFiles: ['package.json', 'src/app/layout.tsx'],
  },
  {
    name: 'Core Components & Pages',
    description: 'Ana sayfa ve temel UI component\'leri',
    tasks: [
      { id: '', title: 'UI primitives (Button, Input, Card...)', type: 'create', targetFiles: ['src/components/ui/'] },
      { id: '', title: 'Page component\'leri', type: 'create', targetFiles: ['src/app/'] },
      { id: '', title: 'Navigation', type: 'create', targetFiles: ['src/components/layout/'] },
    ],
    acceptanceCriteria: ['Sayfalar arası geçiş çalışıyor', 'Component\'ler re-usable', 'Responsive tasarım'],
    estimatedFiles: ['src/components/', 'src/app/'],
  },
];

const PYTHON_BASE: BaseTemplate = [
  {
    name: 'Project Setup',
    description: 'Python projesi, virtualenv, pyproject.toml, linter',
    tasks: [
      { id: '', title: 'pyproject.toml & dependencies', type: 'config', targetFiles: ['pyproject.toml', 'requirements.txt'] },
      { id: '', title: 'Proje yapısı', type: 'create', targetFiles: ['src/__init__.py', 'src/main.py'] },
      { id: '', title: 'Linter & formatter', type: 'config', targetFiles: ['ruff.toml', '.pre-commit-config.yaml'] },
    ],
    acceptanceCriteria: ['pip install çalışıyor', 'pytest çalışıyor', 'Lint hatasız'],
    estimatedFiles: ['pyproject.toml', 'src/main.py'],
  },
  {
    name: 'Core Business Logic',
    description: 'Domain modelleri, servis katmanı, temel iş mantığı',
    tasks: [
      { id: '', title: 'Domain modelleri', type: 'create', targetFiles: ['src/models/'] },
      { id: '', title: 'Service layer', type: 'create', targetFiles: ['src/services/'] },
      { id: '', title: 'Unit tests', type: 'test', targetFiles: ['tests/'] },
    ],
    acceptanceCriteria: ['Core modeller tanımlı', 'Servisler test edildi', 'Type hint\'ler eksiksiz'],
    estimatedFiles: ['src/models/', 'src/services/'],
  },
];

const GO_BASE: BaseTemplate = [
  {
    name: 'Project Setup',
    description: 'Go modül init, proje yapısı, linter',
    tasks: [
      { id: '', title: 'go.mod & proje yapısı', type: 'config', targetFiles: ['go.mod', 'cmd/main.go'] },
      { id: '', title: 'Makefile & CI', type: 'config', targetFiles: ['Makefile'] },
    ],
    acceptanceCriteria: ['go build başarılı', 'go test çalışıyor', 'golangci-lint hatasız'],
    estimatedFiles: ['go.mod', 'cmd/main.go'],
  },
  {
    name: 'Core Business Logic',
    description: 'Domain modelleri, servis katmanı',
    tasks: [
      { id: '', title: 'Domain types & interfaces', type: 'create', targetFiles: ['internal/domain/'] },
      { id: '', title: 'Service layer', type: 'create', targetFiles: ['internal/service/'] },
      { id: '', title: 'Unit tests', type: 'test', targetFiles: ['internal/service/*_test.go'] },
    ],
    acceptanceCriteria: ['Interface\'ler tanımlı', 'Servisler test edildi'],
    estimatedFiles: ['internal/domain/', 'internal/service/'],
  },
];

export const STACK_TEMPLATES: Record<StackType, BaseTemplate> = {
  'typescript-node': NODE_BASE,
  'react': REACT_BASE,
  'python': PYTHON_BASE,
  'go': GO_BASE,
  'other': NODE_BASE, // fallback
};

// ── Common Final Phases ─────────────────────────────────────

export const TESTING_PHASE: Omit<ProjectPhase, 'id' | 'dependsOn'> = {
  name: 'Testing & QA',
  description: 'Entegrasyon testleri, e2e testleri, code coverage',
  tasks: [
    { id: '', title: 'Integration tests', type: 'test', targetFiles: ['tests/integration/'] },
    { id: '', title: 'E2E tests (eğer UI varsa)', type: 'test', targetFiles: ['tests/e2e/'] },
    { id: '', title: 'Coverage hedefi kontrol', type: 'test', targetFiles: [] },
  ],
  acceptanceCriteria: ['Integration testler geçiyor', 'Coverage > %70', 'CI pipeline yeşil'],
  estimatedFiles: ['tests/'],
};

export const DOCUMENTATION_PHASE: Omit<ProjectPhase, 'id' | 'dependsOn'> = {
  name: 'Documentation',
  description: 'README, API docs, mimari dokümantasyonu',
  tasks: [
    { id: '', title: 'README.md', type: 'document', targetFiles: ['README.md'] },
    { id: '', title: 'API dokümantasyonu', type: 'document', targetFiles: ['docs/api.md'] },
    { id: '', title: '.env.example', type: 'config', targetFiles: ['.env.example'] },
  ],
  acceptanceCriteria: ['README kurulum talimatları içeriyor', 'API endpoint\'leri dokümante edildi'],
  estimatedFiles: ['README.md', 'docs/'],
};
