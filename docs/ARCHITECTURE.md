# SYSTEM ARCHITECTURE CONSTITUTION

## 1. Overview & High-Level Topology

The Business Operating System is structured as a modular TypeScript monorepo deployed via containerized services managed by Coolify on standard VPS infrastructure:

1. **Client / Web Application (`apps/web`):**
   - Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS.
   - Renders high-density, accessible, anti-slop business interfaces (Taste-Skill standard).
   - Communicates with backend via type-safe Server Actions and REST API routes.
2. **Core Backend & API Layer:**
   - Embedded inside Next.js route handlers and Fastify micro-routes.
   - Handles tenant context resolution, RBAC guards, and metadata validation.
3. **Background Worker Cluster (`apps/worker`):**
   - Built on Node.js and BullMQ backed by Redis 7.
   - Processes external webhook ingress (Meta Lead Ads, WhatsApp Cloud API), Smart Rules execution, scheduled follow-up alerts, and batch imports/exports.
4. **AI Brain Microservice (`services/ai-brain`):**
   - Lightweight Python FastAPI microservice.
   - Integrates LiteLLM (multi-provider gateway) and Langfuse (observability).
   - Executes deep document parsing (PyMuPDF) and schema-grounded Text-to-SQL generation.
5. **Persistence Layer:**
   - PostgreSQL 16 with Row-Level Security (RLS) enabled on all tenant tables.
   - `pgvector` extension for storing and querying vector embeddings directly within the tenant-isolated SQL database.
   - Redis 7 for queue management, session caching, and rate limiting.
   - S3-compatible Object Storage (MinIO locally / Wasabi/AWS S3 in production).

---

## 2. Directory Responsibilities

- `/apps/web`: Frontend application and tenant workspace.
- `/apps/worker`: BullMQ background job processor and cron scheduler.
- `/services/ai-brain`: Python service for RAG, document parsing, and Text-to-SQL.
- `/packages/types`: Shared TypeScript interfaces, entity models, and Zod schemas.
- `/packages/database`: PostgreSQL schema, RLS policies, migrations, and tenant-scoped connection client.
- `/packages/core`: Core domain logic (Smart Rules evaluator, attribution math, custom fields validator).
- `/packages/logger`: High-performance JSON logger with correlation IDs.
- `/docs`: Permanent technical documentation and architectural decision records.
- `/scripts`: Administrative scripts, disaster recovery drills, and RLS fuzzing tests.

---

## 3. Communication Patterns

- **Synchronous Web Requests:** Handled over HTTP/2 with JSON payloads. Every request must carry an `x-correlation-id` header for end-to-end tracing.
- **Asynchronous Tasks:** Enqueued directly to BullMQ Redis queues. Handlers must be idempotent and support exponential retry backoffs.
- **Real-Time Client Updates:** Handled via Server-Sent Events (SSE) or lightweight Redis Pub/Sub for real-time lead alerts.
