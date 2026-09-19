# Knowledge Engine — AI Agent Context & Repository Map

Welcome AI coding agent! Refer to this context guide to quickly navigate repository directories, architecture specifications, and best practice skills.

---

## 📚 1. Project Documentation Vault (`docs/`)

All system requirements, architectural patterns, domain specs, infrastructure guides, and Architecture Decision Records (ADRs) reside in the `docs/` directory.

> **CRITICAL RULE**: Before writing or modifying code in a subsystem, read the corresponding documentation file in `docs/` first!

- **Authority Hierarchy & Vault Index**: [docs/README.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/README.md)
  - *Hierarchy*: Current Code $\rightarrow$ Accepted ADRs $\rightarrow$ Architecture $\rightarrow$ Domain Specs $\rightarrow$ Product Requirements $\rightarrow$ Roadmap.
  - *Discrepancy Rule*: If code and documentation disagree, do not silently change either. Identify and document the discrepancy first.

### Navigation Index for `docs/`

#### Product
- **Vision & Scope**: [docs/product/context.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/product/context.md)
- **Functional (`FR-xxx`) & Non-Functional (`NFR-xxx`) Requirements**: [docs/product/requirements.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/product/requirements.md)
- **Roadmap & Phase Status**: [docs/product/roadmap.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/product/roadmap.md)

#### Architecture
- **System Overview & Context**: [docs/architecture/overview.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/architecture/overview.md)
- **Asynchronous Ingestion Pipeline**: [docs/architecture/ingestion.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/architecture/ingestion.md)
- **Retrieval & Grounding Strategy**: [docs/architecture/retrieval.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/architecture/retrieval.md)
- **Chat Engine & Streaming**: [docs/architecture/chat.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/architecture/chat.md)
- **Reliability & Resiliency Principles**: [docs/architecture/reliability.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/architecture/reliability.md)

#### Domain Models
- **Documents & DocumentVersions**: [docs/domain/documents.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/domain/documents.md)
- **IngestionJobs State Machine**: [docs/domain/ingestion-jobs.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/domain/ingestion-jobs.md)
- **Structure-Aware Chunking**: [docs/domain/chunking.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/domain/chunking.md)
- **Vector Embedding Rules**: [docs/domain/embeddings.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/domain/embeddings.md)
- **Conversations & Citations**: [docs/domain/conversations.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/domain/conversations.md)

#### Infrastructure
- **AWS Service Roles**: [docs/infrastructure/aws.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/infrastructure/aws.md)
- **PostgreSQL & `pgvector` Schema**: [docs/infrastructure/database.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/infrastructure/database.md)
- **SQS & Transactional Outbox**: [docs/infrastructure/messaging.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/infrastructure/messaging.md)

#### Decisions (ADRs)
- **ADR-001**: PostgreSQL + `pgvector` Store ([docs/decisions/ADR-001-postgresql-pgvector.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-001-postgresql-pgvector.md))
- **ADR-002**: AWS SQS Work Queue vs. Kinesis ([docs/decisions/ADR-002-sqs-over-kinesis.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-002-sqs-over-kinesis.md))
- **ADR-003**: Transactional Outbox Pattern ([docs/decisions/ADR-003-transactional-outbox.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-003-transactional-outbox.md))
- **ADR-004**: Self-Hosted Embedding Strategy ([docs/decisions/ADR-004-self-hosted-embeddings.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-004-self-hosted-embeddings.md))
- **ADR-005**: Local/Free LLM Abstraction Boundary ([docs/decisions/ADR-005-local-llm.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-005-local-llm.md))
- **ADR-006**: External Object Streaming Ingestion ([docs/decisions/ADR-006-external-object-streaming-ingestion.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/decisions/ADR-006-external-object-streaming-ingestion.md))

#### Development Standards
- **Implementation Progress**: [docs/development/implementation-plan.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/development/implementation-plan.md)
- **Coding Conventions & Rules**: [docs/development/coding-conventions.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/development/coding-conventions.md)
- **Testing Strategy**: [docs/development/testing-strategy.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/docs/development/testing-strategy.md)

---

## 🛠️ 2. Agent Skills & Best Practices (`.agents/skills/`)

Always read the relevant `SKILL.md` instructions before writing, reviewing, or refactoring code:

- **NestJS Best Practices**: [nestjs-best-practices/SKILL.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/.agents/skills/nestjs-best-practices/SKILL.md)
  - *Usage*: Use when writing controllers, modules, dependency injection, validation pipes, or error handling in `apps/backend/`.
- **Next.js App Router Patterns**: [nextjs-app-router-patterns/SKILL.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/.agents/skills/nextjs-app-router-patterns/SKILL.md)
  - *Usage*: Use when building Next.js 14+ frontend pages, layouts, Server Components, or streaming UI in `apps/web/`.
- **Test-Driven Development**: [tdd/SKILL.md](file:///c:/Users/Admin/Desktop/Coding/knowledge-engine/.agents/skills/tdd/SKILL.md)
  - *Usage*: Use when writing tests first, red-green-refactor flows, or integration tests.

---

## 📁 3. Workspace Layout

```text
c:\Users\Admin\Desktop\Coding\knowledge-engine\
├── AI_CONTEXT.md              # Entry-point repository guide for AI agents
├── docs/                      # Production documentation vault (Obsidian + Markdown)
├── .agents/skills/            # Agent skills & architecture pattern guides
│
├── apps/
│   ├── backend/               # NestJS API Server & Ingestion Worker
│   │   ├── src/               # Controllers, modules, services, config validation
│   │   ├── test/              # E2E integration tests (app.e2e-spec.ts)
│   │   ├── jest.config.ts     # SWC-backed unit test runner
│   │   └── tsconfig.json      # NestJS CommonJS tsconfig
│   │
│   ├── web/                   # Next.js 14+ Web Application
│   └── app/                   # Expo Mobile Application (stub)
│
└── packages/
    ├── typescript-config/     # Shared tsconfig bases (nestjs.json, nextjs.json)
    ├── eslint-config/         # Shared ESLint rules
    └── ui/                    # Shared React UI component library
```

---

## ⚙️ 4. Common Execution Commands

- **Start Dev Services**: `pnpm dev`
- **Typecheck All Packages**: `pnpm check-types`
- **Run Backend Unit Tests**: `pnpm --filter backend test`
- **Run Backend E2E Tests**: `pnpm --filter backend test:e2e`
- **Build All Monorepo Apps**: `pnpm build`

## 5. Skills

Before starting any implementation:

1. Inspect the available project/agent skills relevant to the requested task.
2. Select only the skills that materially apply to the task.
3. Read the selected skill instructions before making implementation decisions.
4. Follow those skill instructions throughout the task.
5. Do not load or apply unrelated skills just because they are available.
6. If multiple skills apply, use the smallest relevant set and resolve any conflicting guidance explicitly.
7. Prefer project-specific instructions and repository conventions over generic skills when they conflict.

Examples:

* TypeScript-heavy work → `typescript-expert` / `typescript-advanced-types`
* Architecture/design-pattern work → `design-patterns`
* OpenSpec workflow → the relevant `openspec-*` skill
* React/Next.js frontend work → `vercel-react-best-practices`
* Accessibility work → `accessibility`
* Test Driven Development → `tdd`
* Code Documentation → Always write comprehensive TSDoc comments (`@remarks`, `@param`, `@returns`, `@throws`, `@example`) for crucial services, classes, methods, repositories, and interfaces.

Before implementation, briefly state which skills were selected and why.