# Changelog

All notable changes to CSNS are documented here.

## [0.8.1] - 2026-03-24

### Added
- **Cross-File Value Checker** — detects mismatches across files:
  - Token TTL vs cookie maxAge
  - Port numbers vs service URLs
  - Env vars used but undefined in .env.example
  - Duplicate constants with different values across files

## [0.8.0] - 2026-03-24

### Added
- **AST Analyzer** — TypeScript compiler API replaces regex for precise analysis:
  - 100% accurate import/export extraction (vs ~90% regex)
  - Function-level call graph (2812 call edges on CSNS itself)
  - Dead function detection (exported but never called externally)
  - Type-only import guaranteed distinction

## [0.7.8] - 2026-03-24

### Added
- **PR Review Mode** — targeted audit on git changes:
  - `csns review` (staged), `csns review --all`, `csns review --commit`
  - Impact analysis: finds files depending on your changes (2 levels)
  - Security + architecture findings filtered to changed files only
  - Verdict: approve / comment / request-changes
  - PR-comment-ready markdown output

## [0.7.7] - 2026-03-24

### Added
- **Smart Scaffold** — brief → multi-entity layered code generation:
  - EntityDetector: 12 entity patterns, relation detection, endpoint generation
  - SmartScaffold: per-entity route + service + repo + Zod schema + DB model
  - Auth scaffolding with JWT middleware
  - Startup env validation (fail-fast)

## [0.7.6] - 2026-03-24

### Added
- **Security Scanner** — 14 automated security rules:
  - SEC-01 through SEC-13: env assertions, SQL injection, secrets, CSP, eval, innerHTML
  - SEC-XVAL: cross-file token TTL vs cookie maxAge mismatch
  - Test file exclusion (no false positives from test fixtures)

## [0.7.5] - 2026-03-24

### Fixed
- Resolver parameter names filtered from flow detection (args, context, _parent)
- Coupling-violations in GraphQL projects now acknowledged
- Health score excludes acknowledged incomplete flows

## [0.7.4] - 2026-03-24

### Fixed
- Expo Router `app/` → route classification
- State stores (`stores/`, Zustand) → service classification
- API client modules → service classification

## [0.7.3] - 2026-03-24

### Added
- **Acknowledged violations** — design decisions vs real bugs distinction
- Auto-acknowledgement: GraphQL patterns, explicit ARCHITECTURE.md decisions, majority convention
- Test files, entry points, React components excluded from violation checks
- Infra endpoints (health/ready/live) excluded from flow checks

## [0.7.2] - 2026-03-24

### Fixed
- Type-only imports (`import type`) no longer trigger wrong-direction violations
- `DependencyEdge.typeOnly` field tracks type-only edges
- Utils/helpers path weight increased (8 vs 6) to prevent middleware misclassification

## [0.7.1] - 2026-03-24

### Fixed
- GraphQL resolver → controller classification
- Apollo Federation/Gateway → route classification
- Comment stripping before regex matching
- Health score scaled by project size (log10)
- 4 new patterns: GraphQL Federation, Resolvers, Event-Driven, Circuit Breaker

## [0.7.0] - 2026-03-24

### Added
- **ReverseEngineer** — architecture recovery + decision audit:
  - Layer classification (controller, service, repo, middleware, etc.)
  - Data flow tracing (route → middleware → service → repo)
  - Architecture violation detection (layer skip, wrong direction, pattern inconsistency)
  - Decision archaeology (DECISIONS.md cross-check with code)
  - Design pattern detection (8 patterns)
  - Health score 0-100
- **AuditGate** — build → audit → fix closed loop
- **Scaffold** — route-based project structure generation

## [0.6.0] - 2026-03-24

### Changed
- **Renamed** project-consciousness → CSNS
- **New CLI**: interactive REPL with `/new`, `/audit`, `/trace`, `/status`, `/log`, `/health`
- **LLM providers + i18n** wired into all modules (Planner, Evaluator, ContextBuilder, Escalator)

## [0.5.0] - 2026-03-24

### Added
- **Multi-model LLM** abstraction: Anthropic, OpenAI, Ollama providers
- **i18n**: English + Turkish locale support
- **Tracer Agent**: static analysis + semantic analysis + runtime tracing
- **Dependency upgrade**: @anthropic-ai/sdk 0.39→0.80, TypeScript 5.7→5.9
