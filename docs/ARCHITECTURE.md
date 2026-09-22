# SYSTEM ARCHITECTURE CONSTITUTION

> Use [PROJECT_MAP.md](./PROJECT_MAP.md) as the fast current-state map. This document describes the broader architecture direction.

## 1. Overview & High-Level Topology

The Business Operating System is a TypeScript monorepo whose current architecture target is a **Modular Monolith**: strong internal domain boundaries inside one product, with separate processes/services introduced only when operationally justified.

1. **Client / Web Application (`apps/web`):** [IMPLEMENTED — APPLICATION FOUNDATION]
   - Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS.
   - High-density, accessible, anti-slop business interfaces adhering to the Taste-Skill standard.
   - Direct integration with `@business-os/core` domain services via Server Actions and REST API routes with secure HttpOnly sessions.
2. **Core Domain & Security Layer (`packages/core`):** [IMPLEMENTED]
   - CRM owns Leads, Lead lifecycle, Tasks, Activities, and customer/contact history.
   - Sales owns Opportunities and forecast-pipeline behavior; the physical compatibility table remains `deals`.
   - Real Estate owns Projects, Units, Visits, Payment Plans, Reservations, and Contracts. Real Estate may reference Sales Opportunities; Sales must not depend on Real Estate.
   - Tenant context resolution (`withTenantContext`), strict RBAC guards, and fail-closed secrets.
   - Metadata engine (`custom_field_definitions` + JSONB `custom_data`), Zod dynamic compilation.
   - Smart Rules (Trigger-Condition-Action) evaluation engine with loop prevention.
   - AES-256-GCM authenticated encryption at rest for third-party credentials.
   - Centralized credential decryption service (`credential-service.ts`) resolving on-demand secrets outside DB transactions.
   - Atomic sliding-window rate limiting with Lua scripts and non-blocking `SCAN` cache.
   - Transactional Outbox processor (`outbox-service.ts`) with atomic `SKIP LOCKED` CTE claiming and deterministic SHA-256 idempotency.
3. **Background Worker Cluster (`apps/worker`):** [PLANNED]
   - Planned standalone Node.js daemon running BullMQ backed by Redis 7.
   - Runtime outbox polling and processing engine is currently implemented in `packages/core/src/rules/outbox-service.ts`.
   - Inbound webhook deduplication (Meta Lead Ads, WhatsApp Cloud API) with HMAC-SHA256 verification.
   - Scheduled SLA escalation scanners and batch import/export workers.
4. **AI Capabilities & Intelligence:**
   - **Structured Intent Text-to-SQL Compiler (`ask-business-service.ts`):** [IMPLEMENTED] - Whitelist-enforced structured query translation with mathematical aggregation constraints.
   - **Vector Knowledge Base & Semantic Search:** [IMPLEMENTED] - pgvector cosine similarity search across tenant documents.
   - **Natural Language Schema & Automation Builder (`ai-builder-service.ts`):** [PROTOTYPE] - Heuristic-based natural language proposal generator for human-in-the-loop review.
   - **Standalone Python AI Brain Microservice (`services/ai-brain`):** [PLANNED] - Future standalone microservice for heavy multi-modal extraction and external agentic loops.
5. **Persistence & Storage Layer:** [IMPLEMENTED]
   - PostgreSQL 16 with Row-Level Security (RLS) enabled on all tenant tables.
   - Relational isolation guaranteed via composite foreign keys `(organization_id, id)` across all tables.
   - Idempotent migration runner with SHA-256 integrity verification (`schema_migrations`).
   - S3-compatible Object Storage (MinIO locally / Wasabi or AWS S3 in production).
   - Production Docker Compose & Coolify deployment manifests [PLANNED / SCAFFOLD].

---

## 2. Directory Responsibilities

- `/apps/web`: Frontend Next.js application foundation and tenant workspace [IMPLEMENTED — APPLICATION FOUNDATION].
- `/apps/worker`: Planned standalone background job daemon [PLANNED]. (Core outbox and worker engines are in `/packages/core` [IMPLEMENTED]).
- `/packages/types`: Shared TypeScript interfaces, entity models, and Zod schemas [IMPLEMENTED].
- `/packages/database`: PostgreSQL schema, RLS policies, composite FK migrations, and migration runner [IMPLEMENTED].
- `/packages/core`: Core domain logic, crypto, rate limiting, and business services [IMPLEMENTED].
- `/packages/logger`: Structured JSON logger with correlation IDs and PII redaction [IMPLEMENTED].
- `/docs`: Permanent technical documentation, architectural decision records, and runbooks [IMPLEMENTED].
- `/scripts`: Administrative scripts, disaster recovery drills, and RLS verification tests [IMPLEMENTED].
- `/services/ai-brain`: Dedicated microservice scaffold for heavy Python LLM pipelines [PLANNED].

---

## 3. Communication Patterns

- **Synchronous Web Requests:** Handled over HTTP/2 with JSON payloads. Every request must carry an `x-correlation-id` header for end-to-end tracing.
- **Asynchronous Side-Effects:** The transactional outbox and processing primitives are implemented in Core. A dedicated standalone worker process is still planned; do not assume `apps/worker` exists today.
- **Real-Time Client Updates:** SSE / Redis Pub/Sub are architectural options for later real-time delivery, not a required current dependency.
