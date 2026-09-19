# SYSTEM ARCHITECTURE CONSTITUTION

## 1. Overview & High-Level Topology

The Business Operating System is structured as a modular TypeScript monorepo deployed via containerized services:

1. **Client / Web Application (`apps/web`):** [IMPLEMENTED]
   - Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS.
   - High-density, accessible, anti-slop business interfaces adhering to the Taste-Skill standard.
   - Communicates with backend via type-safe Server Actions and REST API routes.
2. **Core Domain & Security Layer (`packages/core`):** [IMPLEMENTED]
   - Tenant context resolution (`withTenantContext`), strict RBAC guards, and fail-closed secrets.
   - Metadata engine (`custom_field_definitions` + JSONB `custom_data`), Zod dynamic compilation.
   - Smart Rules (Trigger-Condition-Action) evaluation engine with loop prevention.
   - AES-256-GCM authenticated encryption at rest for third-party credentials.
   - Atomic sliding-window rate limiting with Lua scripts and non-blocking `SCAN` cache.
3. **Background Worker Cluster (`apps/worker`):** [IMPLEMENTED]
   - Built on Node.js and BullMQ backed by Redis 7.
   - Transactional Outbox processor (`outbox_events`) for reliable third-party dispatch (WhatsApp, webhooks).
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

- `/apps/web`: Frontend application and tenant workspace [IMPLEMENTED].
- `/apps/worker`: BullMQ background job processor, outbox dispatcher, and cron scheduler [IMPLEMENTED].
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
- **Asynchronous Side-Effects:** Enqueued transactionally via `outbox_events` and processed by BullMQ background workers.
- **Real-Time Client Updates:** Handled via Server-Sent Events (SSE) and lightweight Redis Pub/Sub for real-time lead alerts.
