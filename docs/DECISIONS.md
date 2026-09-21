# ARCHITECTURAL DECISION RECORDS (ADRs)

## ADR-001: Rejection of Twenty CRM in Favor of Custom Lean Metadata Engine

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** We evaluated open-source Twenty CRM for metadata and custom field management.
- **Options Considered:**
  1. Fork or embed Twenty CRM.
  2. Build a custom lean metadata engine using PostgreSQL JSONB + Zod.
- **Decision:** Option 2.
- **Rationale:**
  - Twenty is licensed under AGPLv3, imposing severe legal risks of forced source disclosure for a commercial SaaS.
  - Twenty's 500k-line codebase is overly complex and difficult for AI coding agents to maintain safely.
  - A custom metadata engine using `custom_field_definitions` and `custom_data` JSONB satisfies all requirements with ~1,500 lines of clean TypeScript.
- **Consequences:** We must implement dynamic form renderers and Zod schema generators in Phase 5.

---

## ADR-002: Rejection of n8n in Favor of Custom Smart Rules Engine

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** We evaluated n8n and Activepieces for customer workflow automation.
- **Options Considered:**
  1. Embed n8n or Activepieces node graph builder.
  2. Build a custom Trigger-Condition-Action (TCA) Smart Rules Engine on BullMQ + Redis.
- **Decision:** Option 2.
- **Rationale:**
  - n8n’s Sustainable Use License strictly forbids offering n8n functionality as a commercial SaaS service without an enterprise contract.
  - Real estate brokers and sales managers find node-and-wire visual graph editors confusing and error-prone.
  - Smart Rules provide pre-validated templates, historical simulation (dry-run mode), and deterministic execution without run-time code generation.
- **Consequences:** Advanced users cannot create arbitrary webhook DAGs in early MVP; all automations use approved templates.

---

## ADR-003: Multi-Tenancy Strategy: Shared Database, Shared Schema with PostgreSQL RLS

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Need an efficient, secure multi-tenant data architecture for standard VPS hosting.
- **Options Considered:**
  1. Database-per-tenant (High operational overhead, expensive connection pools).
  2. Schema-per-tenant (Complex dynamic migrations, connection pool starvation).
  3. Shared database, shared schema with PostgreSQL Row-Level Security (RLS).
- **Decision:** Option 3.
- **Rationale:**
  - Provides mathematically enforced tenant isolation at the database engine level.
  - Highly cost-effective on standard VPS infrastructure.
  - Single schema ensures unified, reproducible migrations across all tenants.
- **Consequences:** Every tenant query must be wrapped in `withTenantContext`, and continuous RLS leak tests must run in CI.

---

## ADR-004: AI Gateway & Telemetry: LiteLLM + Langfuse

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Need unified multi-model LLM access (OpenAI, Gemini, Anthropic) with strict cost control and observability.
- **Decision:** Adopt LiteLLM as the provider gateway and Langfuse for full LLM call tracing, token cost accounting, and quality evaluation.
- **Rationale:** Permissive licenses (MIT), zero vendor lock-in, automated failover during provider outages, and deep auditability.

---

## ADR-005: Meta Lead Ads Cryptographic Signature Verification & Webhook Idempotency

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Meta Lead Ads webhooks are delivered concurrently and retried automatically on timeouts or delivery glitches. Leads must never be duplicated, and unauthenticated/spoofed webhook calls must be rejected with zero timing vulnerability.
- **Decision:**
  1. Verify `X-Hub-Signature-256` using Node.js native `crypto.timingSafeEqual` over HMAC-SHA256 digests.
  2. Implement an RLS-isolated `webhook_events` registry table with a unique composite key on `(organization_id, provider, event_id)`.
  3. Replay / retried webhook requests are acknowledged with 200 OK and marked `DUPLICATE_IGNORED` without inserting redundant leads.
  4. Repeat submissions matching existing leads by phone number update the lead and record a timestamped timeline activity note without creating duplicate lead rows.
- **Rationale:** Provides guaranteed zero-duplicate lead ingestion, timing-safe cryptographic security, and maintains rich engagement history for sales reps.

---

## ADR-006: Official WhatsApp Cloud API Architecture & Real-Time Timeline Integration

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Customer conversations occur heavily over WhatsApp in the real estate sector. Unofficial WhatsApp Web scrapers frequently get numbers banned and break on UI changes.
- **Decision:**
  1. Rely exclusively on Meta's official WhatsApp Business Cloud API (Graph API).
  2. Implement HMAC-SHA256 signature verification and verify challenge handshake for inbound webhooks.
  3. Inbound messages automatically link to existing contacts by phone number or auto-create new CRM leads with `source = 'WHATSAPP'`.
  4. Two-way messages append in real-time to the lead's activity timeline (`activity_type = 'WHATSAPP'`).
  5. Connect Smart Rules automation engine to dispatch pre-approved Meta message templates via action `whatsapp.send_template`.
- **Rationale:** Eliminates number banning risk, guarantees 99.9% uptime, provides clean two-way customer messaging history, and automates instant outreach upon lead creation.

---

## ADR-007: Time-Based Triggers, Inactivity SLA Escalations, and Scheduled Job Auditing

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Sales leads often go cold if not followed up within strict SLA windows (e.g. 24 hours), unit reservations expire without alerts, and overdue tasks linger uncompleted. The system required automated time-based scanning without introducing heavyweight cron infrastructure.
- **Decision:**
  1. Build modular tenant-scoped time scanners: `scanInactivityExceededLeads`, `scanExpiringReservations`, and `scanDueTasks`.
  2. Integrate scanners directly with the Smart Rules engine so time events trigger `lead.inactivity_exceeded`, `reservation.expiring`, and `task.due` triggers.
  3. Record every scanner run in an RLS-protected `scheduled_job_runs` table with run duration, entities evaluated, rules triggered, and completion status.
- **Rationale:** Maintains sales team SLA accountability, releases held inventory when reservations expire, and provides complete execution auditability without external cron complexity.

---

## ADR-008: AI Brain Knowledge Retrieval Engine with pgvector and Hybrid RAG Context

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** An AI-Configurable Business Operating System requires grounding LLM responses in company knowledge (policies, brochures, FAQs) as well as live operational CRM data (unit availability, pricing, lead state).
- **Decision:**
  1. Use PostgreSQL native `pgvector` extension with 1536-dimensional vector embeddings and HNSW cosine distance indexing (`vector_cosine_ops`).
  2. Store parent documents in `knowledge_documents` and semantic segments in `document_chunks`, strictly protected with Row-Level Security (RLS) guaranteeing zero multi-tenant vector leakage.
  3. Implement boundary-aware sliding-window chunking (`chunkText`) and a deterministic unit-normalized embedding provider for offline CI.
  4. Implement `retrieveGroundedContext` combining vector similarity matches with real-time live CRM entity records (Leads and Units) for grounded RAG.
- **Rationale:** Prevents hallucination, guarantees absolute multi-tenant vector isolation, and provides schema-grounded context combining static knowledge with live CRM operational status.

---

## ADR-009: Marketing Attribution & Real Estate Executive Dashboards

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Real estate operations require tracking campaign ad spend against signed contract revenue, computing lead-to-deal conversion velocity, and visualizing executive KPIs without expensive BI tools.
- **Decision:**
  1. Introduce `campaign_spend_logs` with multi-tenant RLS for tracking daily/monthly spend per marketing channel and campaign.
  2. Implement multi-touch attribution models: First-Touch (lead acquisition credit) and Last-Touch (contract closing credit).
  3. Implement `getExecutiveDashboardMetrics` aggregating sales velocity, active pipeline volume, closed revenue, CAC, and channel-by-channel ROI.
- **Rationale:** Provides leadership with real-time financial clarity, CAC and ROI metrics, and closed-loop marketing attribution directly within tenant boundaries.

---

## ADR-010: "Ask Your Business" Safe Text-to-SQL & Real Estate Schema Catalog

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Business users need natural language querying ("كم عدد الليدات الجديدة اليوم؟", "ما إجمالي مبيعات مشروع الجونة؟") without exposing the system to SQL injection, destructive queries, or cross-tenant data leaks.
- **Decision:**
  1. Build a strict AST/regex `QuerySafetyGuard` that enforces read-only SELECT queries, rejects destructive DDL/DML, multi-statement queries, and system catalog access.
  2. Map conversational queries against a strongly typed Real Estate Schema Catalog and Intent Synthesizer.
  3. Execute safe queries strictly within `withTenantContext(organizationId, ...)` ensuring Postgres RLS applies even if an attacker crafts an adversarial query.
  4. Combine structured query execution with vector knowledge retrieval for hybrid answers.
- **Rationale:** Enables non-technical users to query their business data naturally while guaranteeing absolute query safety and zero multi-tenant data leakage.

---

## ADR-011: AI Builder - Safe Configuration Assistant via Reversible Change Proposals

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Users want to configure custom fields, automation rules, and saved views using natural language prompts without violating AGENTS.md Invariants 3.2 (no dynamic ALTER TABLE DDL) and 3.3 (no customer-exposed code).
- **Decision:**
  1. Structure all natural language modifications into a two-step human-in-the-loop workflow: `parseConfigurationIntent` produces an inspectable `ChangeProposal` with a preview diff.
  2. Application (`applyChangeProposal`) checks permissions via `assertPermission(context, 'create', resource)` and routes to metadata/domain services (`createCustomFieldDefinition`, `createRule`, `createSavedView`).
  3. Custom fields are stored in `custom_field_definitions` and populated in `custom_data` JSONB columns, never modifying physical table schemas.
  4. Custom field keys are sanitized to valid ASCII identifiers via transliteration and safe deterministic hashing.
- **Rationale:** Delivers seamless AI-driven customization with complete transparency, role-based safety, zero risk of schema corruption, and full tenant isolation.

---

## ADR-012: Operations Observability, PII-Safe Error Context, and Multi-Tier Access Model

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** Operating a multi-tenant SaaS requires full traceability across webhook ingestion, CRM workflows, and AI generation, while strictly protecting customer PII and restricting automated agent operational access.
- **Decision:**
  1. Build a centralized `feature_flags` engine supporting global kill-switches, tenant-targeted beta lists, and deterministic percentage rollouts.
  2. Implement an end-to-end `DiagnosticContext` propagator (`trace_id`, `correlation_id`, `organization_id`, `release_version`).
  3. Implement `sanitizeDiagnosticError` that automatically scrubs Bearer tokens, passwords, customer phone numbers, and email addresses before error persistence or logging.
  4. Enforce a 3-tier operational access model:
     - `OBSERVE`: Read-only health, metrics, and incident status (default for agents).
     - `SAFE_OPS`: Controlled, audited operations (e.g. job retry, connector toggling).
     - `BREAK_GLASS`: Emergency operations requiring explicit human approval and permanent audit logging.
- **Rationale:** Prevents unauthorized production mutations, ensures GDPR/privacy compliance through automated PII scrubbing, and provides instant incident diagnosis without SSH access.

---

## ADR-013: Production Deployment via Coolify/Docker and Backup Viability Drill

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** The system requires reproducible, zero-downtime production deployment on VPS infrastructure without Kubernetes overhead, combined with proven backup and disaster recovery validation.
- **Decision:**
  1. Provide production Docker Compose and Coolify deployment configurations (`deploy/docker-compose.prod.yml`, `deploy/coolify.json`) with health check dependencies and rolling update policies.
  2. Enforce the Expand-Migrate-Contract rule for all database migrations, flagging immediate `DROP TABLE`, `DROP COLUMN`, or table-locking operations before execution.
  3. Implement automated backup manifest generation (`createBackupManifest`) with SHA-256 cryptographic verification.
  4. Adhere to Rule 46: _"A backup that has never been restored is not considered proven."_ Build automated verification drills (`verifyBackupViability`) to guarantee archive restorability.
- **Rationale:** Eliminates deployment failures, guarantees zero-downtime rolling updates, and ensures 100% data recoverability in disaster scenarios.

---

## ADR-014: Controlled Pilot Onboarding and Realistic Egyptian Real Estate Seed Baseline

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** To ensure the system operates reliably under real-world commercial conditions, the platform requires an automated pilot onboarding pipeline with a realistic domain baseline for Egyptian real estate developers.
- **Decision:**
  1. Implement `provisionPilotOrganization` to automate tenant creation, staff role assignment (`SALES_MANAGER`, `SALESPERSON`), and pilot feature flag enablement in a single atomic workflow.
  2. Build a high-fidelity Egyptian real estate seed generator (`seedPilotRealEstateData`) seeding major projects (Taj City, Sarai), diverse unit inventory with EGP pricing, realistic leads, round-robin automation rules, and standard 8-year payment schedules.
  3. Validate the complete end-to-end commercial lifecycle (lead ingestion -> round-robin assignment -> unit reservation -> contract execution -> revenue attribution -> executive dashboard) with 100% tenant isolation.
- **Rationale:** Provides an out-of-the-box turnkey experience for prospective real estate clients, accelerates pilot go-lives, and continuously verifies multi-tenant isolation against live commercial data.

---

## ADR-015: Sliding-Window Rate Limiting and Keyspace-Isolated Tenant Caching

- **Date:** 2026-09-19
- **Status:** APPROVED
- **Context:** As the platform transitions to production and connects to the user-facing web client, it requires strict protection against brute-force attacks, API quota exhaustion, and unconstrained database queries, while preserving absolute tenant isolation (Rule 3.1).
- **Decision:**
  1. Implement a distributed sliding-window counter rate limiter in `@business-os/core` (`consumeRateLimit`, `checkRateLimit`, `resetRateLimit`) supporting IP keys (`rl:ip:{ip}`) for public endpoints and webhook ingress, and Tenant keys (`rl:tenant:{orgId}:{quota}`) for AI generation and API tiers, with seamless in-memory fallback.
  2. Implement a strictly isolated multi-tenant caching layer (`withTenantCache`, `getTenantCache`, `setTenantCache`, `invalidateTenantCache`) enforcing the mandatory keyspace pattern `tenant:{organizationId}:{namespace}:{key}`.
  3. Prohibit cross-tenant cache access, contamination, or wildcard invalidation, with cryptographic tenant verification before returning or invalidating cached payloads.
- **Rationale:** Prevents denial-of-service and noisy-neighbor issues across tenants, minimizes database load on frequent query endpoints, and ensures zero data leakage in shared Redis cache instances.

---

## ADR-016: H0 Foundation Hardening, Relational Isolation, and Truthfulness

- **Date:** 2026-09-19
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Following the 20-phase MVP build, an exhaustive foundation audit identified critical hardening requirements in database relational isolation, secret fail-closed behavior, asynchronous execution reliability, and architectural documentation truthfulness.
- **Decision:**
  1. **Enforce Database-Level Composite FKs:** Added `UNIQUE (organization_id, id)` and composite foreign keys across all tenant tables (`units`, `visits`, `reservations`, `contracts`, `deals`, `activities`, `tasks`) so child entities can never link to cross-tenant parent entities at the relational engine level.
  2. **Migration Checksum & Runner Tracking:** Implemented `schema_migrations` tracking with SHA-256 integrity verification (`migrator.ts`) to ensure deterministic and immutable schema history.
  3. **Strict Fail-Closed Secrets & AES-256-GCM At Rest:** Prohibited default/weak JWT secrets in production environments. Encrypted third-party tokens (Meta Lead Ads, WhatsApp Cloud API) at rest using authenticated AES-256-GCM (`v1:<iv>:<tag>:<ciphertext>`) and masked secrets in DTOs.
  4. **Active Tenant Membership Guard:** Prohibited assigning leads, deals, or tasks to user IDs that are not active members of the tenant organization.
  5. **Transactional Outbox for External Side-Effects:** Replaced direct third-party HTTP dispatches in Smart Rules with an asynchronous, RLS-isolated `outbox_events` table and background worker, preventing distributed transaction failures and nested transaction locks.
  6. **Lua-Based Atomic Rate Limiting:** Converted multi-command rate limiting to single atomic Lua scripts and replaced blocking `KEYS` commands with non-blocking cursor `SCAN` in cache and rate-limiter sweeps.
  7. **Documentation Truthfulness Standards:** Explicitly demarcated all system features with truthfulness tags: `[IMPLEMENTED]`, `[PROTOTYPE]`, and `[PLANNED]`.
- **Rationale:** Guarantees absolute enterprise tenant isolation, eliminates silent security vulnerabilities, prevents distributed race conditions, and ensures full transparency for engineering and stakeholders.

---

## ADR-017: H0-v2 Stabilization — Test Concurrency, On-Demand Secret Resolution, and Least-Privilege DB Roles

- **Date:** 2026-09-19
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Review of commit `b4a2fc7` revealed parallel CI worker race conditions, encrypted ciphertext leakage into API dispatchers, network calls trapped inside database transactions, outbox transaction lock losses, non-deterministic idempotency timestamps, and lack of runtime DB role hardening.
- **Decision:**
  1. **Vitest Global Setup Migration:** Moved sequential migration execution to `tests/global-setup.ts` running once before parallel worker threads spawn, eliminating all CI DDL race conditions.
  2. **Central Decrypted Credential Service:** Built `credential-service.ts` to decrypt tokens on demand and decouple external HTTP dispatch (WhatsApp, Meta) strictly outside `withTenantContext` database transactions.
  3. **Atomic Outbox CTE Claiming & Deterministic Idempotency:** Replaced fragmented `FOR UPDATE SKIP LOCKED` with an atomic Common Table Expression (`WITH claimable AS (...) UPDATE ... RETURNING *`) and deterministic SHA-256 keys based on rule/entity/action tuples.
  4. **Platform Admin Feature Flag Guard:** Restricted `setFeatureFlag` strictly to `PlatformAdminContext` (`isPlatformAdmin: true`), rejecting tenant admins/owners.
  5. **Honest Ops Console Access Control:** Removed false `success: true` stubs for unimplemented operational actions, raising explicit `NotImplementedError`.
  6. **Database Runtime Role Hardening:** Applied migration `0014_h0_runtime_role_hardening.sql` enforcing `ALTER ROLE app_user NOBYPASSRLS`, revoking public schema `CREATE`, and restricting runtime application access to strict DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
- **Rationale:** Completely stabilizes concurrent CI pipelines, prevents deadlocks and lock contention during outbound network calls, protects encrypted tokens from being transmitted as raw ciphertext, and enforces least-privilege security boundaries at the database engine level.

---

## ADR-018: H0 Stabilization Patch v2.1 — SECURITY DEFINER Routers, Outbox Leases, and Durable WhatsApp Delivery

- **Date:** 2026-09-19
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Deep review of commit `16c495a` identified edge cases in RLS tenant resolution for external webhooks, runtime role credential management, outbox crash recovery, rule action idempotency scope, and network ambiguity handling in WhatsApp dispatch.
- **Decision:**
  1. **SECURITY DEFINER Pre-Routing Functions:** Created `public.resolve_meta_tenant` and `public.resolve_whatsapp_tenant` owned by dedicated non-login role `business_os_router_owner WITH NOLOGIN BYPASSRLS`. Search path locked to `pg_catalog, public`. Fully schema-qualified. `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO app_user`. Returns ONLY minimal routing tuple `(organization_id, integration_id)`, zero secrets or tokens exposed.
  2. **Dedicated Runtime DB Role Provisioning:** Decoupled `app_user` password provisioning from normal startup migrations into a standalone administrative script (`scripts/provision-db-roles.ts`). In production, strictly requires `APP_DB_PASSWORD` (min 16 chars, rejects weak/trivial passwords).
  3. **Outbox Lease Tracking & Crash Recovery:** Added `processing_started_at` and `worker_id` columns to `outbox_events`. Atomic claim CTE reclaims jobs stuck in `PROCESSING` past 5-minute lease expiry. Missing handlers transition immediately to `FAILED` with diagnostics rather than remaining stuck in `PROCESSING`.
  4. **Execution-Level Rule Action Idempotency:** Scoped action idempotency keys to `sha256(organizationId:ruleId:executionId:actionIndex)`. Same-execution retries are safely deduplicated, while future rule executions on the same lead/rule trigger without suppression.
  5. **Decoupled Meta Graph Fetch:** In `ingestMetaLead`, resolve integration via `resolve_meta_tenant`, execute external Graph API network fetch completely outside database transactions, then enter a short tenant transaction for deduplication and persistence.
  6. **Durable WhatsApp Delivery Semantics:** Replaced claims of "exactly-once" delivery with an explicit multi-state lifecycle: `PENDING` -> `SENDING` -> `SENT` | `FAILED` | `UNKNOWN`. Atomic pre-dispatch write of message and outbox event. Network timeouts / ambiguous errors during `SENDING` transition status to `UNKNOWN` to avoid blind duplicate sends. Later webhooks reconcile against `wamid`.
- **Rationale:** Eliminates RLS deadlock on inbound webhooks, guarantees resilient crash recovery in asynchronous outbox processing, avoids double-messaging end clients in Egyptian real estate workflows, and maintains least privilege and zero data leakage across tenants.

---

## ADR-019: H0 Stabilization Patch v2.2 — Routing Uniqueness, Enqueue-Only Outbox, and Crash Resiliency

- **Date:** 2026-09-19
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Review of commit `ed1afe6` identified two critical P0 vulnerabilities and edge cases: (1) Lack of platform-wide active uniqueness on integration identifiers (`page_id`, `phone_number_id`) allowed cross-tenant routing ambiguity in `SECURITY DEFINER` functions; (2) `sendWhatsAppMessage()` enqueued an outbox event while directly dispatching HTTP requests, leaving outbox rows `PENDING` and causing duplicate sends when workers run; (3) Stale `PROCESSING` outbox leases failed to verify `retry_count < max_retries`, and unregistered handlers caused infinite retry loops; (4) Production compose retained a weak password fallback.
- **Decision:**
  1. **Global Active Integration Uniqueness (P0 Cross-Tenant Protection):** Migration `0016_h0_global_active_integration_uniqueness.sql` applies partial unique indexes:
     - `CREATE UNIQUE INDEX idx_meta_integrations_active_page_id ON meta_integrations(page_id) WHERE is_active = true;`
     - `CREATE UNIQUE INDEX idx_whatsapp_integrations_active_phone_id ON whatsapp_integrations(phone_number_id) WHERE is_active = true;`
       No two tenants can simultaneously activate the same Meta Page ID or WhatsApp Phone Number ID.
  2. **Enqueue-Only WhatsApp Outbox Architecture (P0 Duplicate Elimination):** Refactored `sendWhatsAppMessage()` to be strictly enqueue-only. It atomically creates the message record in `PENDING` status and enqueues the `whatsapp.send_outbound` outbox event in the tenant transaction. Zero HTTP provider network calls occur within `sendWhatsAppMessage()`.
  3. **Outbox Worker Dispatch & Terminal Suppression:** External provider dispatch is exclusively handled by `handleWhatsAppOutboundEvent` / `processPendingWhatsAppOutbox()`. When ambiguous network timeouts occur, the message is marked `UNKNOWN` and the outbox event transitions to `FAILED` with `retry_count = max_retries` via `TerminalOutboxError` to suppress blind retries pending webhook reconciliation.
  4. **Outbox Lease & Missing Handler Resiliency:** The CTE claim query now enforces `status = 'PROCESSING' AND retry_count < max_retries AND processing_started_at < NOW() - INTERVAL '5 minutes'`. Unregistered event types are marked `FAILED` with `retry_count = max_retries` (Dead Letter), preventing infinite retry loops.
  5. **Fail-Closed Production Compose & Fixed Runtime Role:** In `deploy/docker-compose.prod.yml`, `${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}` enforces fail-closed startup without fallback. The runtime role name is strictly fixed to `app_user` in `scripts/provision-db-roles.ts`.
- **Recorded Technical Debt & Future Architectural Improvements:**
  - _Trigger/Source Idempotency:_ Propagate stable trigger/event execution ID from webhook/job/scanner source for true end-to-end source-event idempotency.
  - _Least-Privilege Routing Owner Grants:_ Restrict `business_os_router_owner` permissions from table-level `SELECT` to column-level `SELECT (id, organization_id, page_id/phone_number_id, is_active)` for defense-in-depth.
  - _Short Claim Transaction in Meta Webhooks:_ Add a pre-claim transaction on `webhook_events` prior to external Meta Graph fetch to avoid redundant network calls during rapid duplicate webhook bursts.
- **Rationale:** Completely eliminates cross-tenant routing hijacking, guarantees zero duplicate message sends in background workers, stabilizes outbox lease recovery, and enforces fail-closed production deployment.

---

## ADR-020: H0 Stabilization Patch v2.3 — Unified WhatsApp Outbox, Crash-After-Send Recovery, and Real API Idempotency

- **Date:** 2026-09-19
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Deep inspection of commit `e8762d3` identified three critical architectural vulnerabilities:
  1. Smart Rules automation generated an isolated event type (`WHATSAPP_SEND_TEMPLATE`) instead of the unified `whatsapp.send_outbound`, and tests bypassed production architecture via an inline `whatsAppClient` execution path inside database transactions.
  2. If an outbox worker crashed after Meta accepted a message but before committing the `SENT` status and `wamid`, the message remained in `SENDING`. Upon lease recovery (after 5 minutes), the worker re-dispatched the message to Meta, causing customer message duplication.
  3. Client-side retries of `sendWhatsAppMessage` with the same `idempotencyKey` generated new message UUIDs that conflicted on the outbox table, leaving orphan `PENDING` records, while retries with the same `messageId` risked returning zero rows on conflict.
  4. Stale `PROCESSING` events with exhausted retries remained stuck in `PROCESSING` indefinitely.
- **Decision:**
  1. **Unified Outbox Helper (`enqueueWhatsAppOutbound`):** Created a single shared transactional helper `enqueueWhatsAppOutbound(tx, context, input, idempotencyKey)` shared by direct WhatsApp sends, Smart Rules, and future AI dispatchers. All pathways emit exclusively `whatsapp.send_outbound`. Removed `whatsAppClient` and all inline provider calls from `executeRuleAction()` and `rule-runner.ts` so even tests strictly execute through the outbox pipeline.
  2. **Elimination of Crash-After-Send Duplicate Window:** In `handleWhatsAppOutboundEvent()`, if `currentMsg.status === 'SENDING'` upon claiming an event, it signifies that an earlier worker crashed or abandoned its lease mid-flight. The message is immediately transitioned to `UNKNOWN` and a `TerminalOutboxError` is thrown, exhausting retries (`retry_count = max_retries`) and preventing duplicate delivery to the customer.
  3. **Truthful Documentation of Crash-After-Send Recovery:** If a worker node crashes after Meta returns `200 OK` but before `wamid` is committed locally, the `wamid` is permanently lost from our local database. Therefore, subsequent status webhooks cannot be correlated by `wamid` automatically. Automatic reconciliation is NOT guaranteed in this specific post-accept crash window; manual review or provider log correlation is required.
  4. **Database-Level API Idempotency (Migration 0017):** Added `idempotency_key VARCHAR(255)` and a partial unique index `idx_wa_msg_org_idempotency_key` on `whatsapp_messages (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Calling `sendWhatsAppMessage` or `enqueueWhatsAppOutbound` with an existing `idempotencyKey` immediately returns the existing message record without creating duplicate outbox events or orphan records.
  5. **Auto-Transition of Exhausted Stale Leases:** In `processPendingOutboxEvents()`, stale `PROCESSING` events (`processing_started_at < NOW() - INTERVAL '5 minutes'`) with `retry_count >= max_retries` are automatically transitioned to `status = 'FAILED'`, keeping database status accurate and clean for observability.
- **Rationale:** Unifies automation and manual messaging under a single durable pipeline, eliminates customer duplicate messaging during worker crashes, ensures exact API idempotency without orphan records, and guarantees complete documentation integrity.

---

## ADR-021: H0 Stabilization Patch v2.4 — Concurrent Idempotency Safe Insertion, Outbox Rollback Verification, WhatsApp Error Retry Classification, and Modular Decoupling

- **Date:** 2026-09-20
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Final review of PR #1 prior to H0 sign-off revealed 3 merge blockers and 2 architectural enhancements:
  1. _Concurrent Idempotency Bug (23505 Unique Violation Aborting Transactions):_ In PostgreSQL transactions, catching a `23505 unique_violation` exception in application code leaves the transaction in an aborted state (`25P02: current transaction is aborted, commands ignored until end of transaction block`). A pre-check followed by raw `INSERT` allowed race conditions where concurrent requests with the same `(organization_id, idempotency_key)` aborted one of the concurrent transactions.
  2. _Missing Rollback Test for Outbox Guarantees:_ The test suite lacked verification that downstream transaction failure after outbox enqueue rolls back both the message and the outbox event, with zero state committed and zero provider calls.
  3. _Coarse WhatsApp API Error Handling:_ Graph API errors were caught indiscriminately. Rate limit (429) and server outages (5xx) were not differentiated from terminal 400 Bad Request / 401 Unauthorized errors, risking premature dead-lettering of transient errors or endless retrying of malformed payloads. Furthermore, ambiguous network timeouts needed structured differentiation.
  4. _Circular Dependency:_ `rule-actions-executor.ts` imported `whatsapp-service.ts`, creating a circular dependency between rules and whatsapp modules.
  5. _Separation of Migrator Database Connection:_ Database migrations executed over the generic application connection pool rather than a dedicated administrative DDL/role management connection.
- **Decision:**
  1. **Atomic Concurrent Idempotency via `ON CONFLICT DO NOTHING`:**
     In `enqueueWhatsAppOutbound`, the raw `INSERT` into `whatsapp_messages` was updated with `ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING *`. If zero rows are returned (indicating a concurrent insert occurred), the existing row is queried immediately within the same transaction without triggering a `25P02` transaction abort. The corresponding outbox event insertion uses `ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`.
  2. **Comprehensive Transactional Outbox Rollback Verification:**
     Added automated test verifying that when an application error occurs downstream of `enqueueWhatsAppOutbound` inside a transaction, the entire transaction rolls back: 0 rows in `whatsapp_messages`, 0 rows in `outbox_events`, and 0 external provider calls.
  3. **Structured WhatsApp API Error Classification & Retry Policy:**
     Introduced `WhatsAppApiError` with `statusCode`, `retryable: boolean`, and `isAmbiguous: boolean`.
     - **Transient Errors (429 Rate Limit, 5xx Server Outages):** Classified as `retryable = true`. In `handleWhatsAppOutboundEvent`, the message status is reset to `PENDING` and a standard `Error` is thrown, allowing the outbox worker to increment `retry_count` and retry upon next schedule until `max_retries`.
     - **Terminal Errors (400 Bad Request, 401 Unauthorized, etc.):** Classified as `retryable = false`. In `handleWhatsAppOutboundEvent`, the message status is set to `FAILED` and a `TerminalOutboxError` is thrown, setting `retry_count = max_retries` and permanently exhausting the event.
     - **Ambiguous Network Dispatches (Timeouts, socket resets during dispatch):** Classified as `isAmbiguous = true`. Message status is transitioned to `UNKNOWN` and `TerminalOutboxError` is thrown to suppress blind customer message duplicates pending webhook reconciliation.
  4. **Decoupled Outbox Service (`whatsapp-outbox-service.ts`):**
     Extracted `enqueueWhatsAppOutbound` into `packages/core/src/whatsapp/whatsapp-outbox-service.ts`. `rule-actions-executor.ts` imports directly from this module, eliminating circular dependencies between `rules` and `whatsapp` packages.
  5. **Independent Administrative Migrator Pool:**
     Added `migratorPool` to `packages/database/src/client.ts` configured via `process.env.MIGRATOR_DATABASE_URL || databaseUrl`. Administrative DDL runner `runPendingMigrations` and checksum verifier `verifyMigrationIntegrity` in `packages/database/src/migrator.ts` connect exclusively through `migratorPool`.
- **Rationale:** Resolves all remaining H0 merge blockers, ensures true concurrency-safe idempotency without transaction corruption, guarantees resilient retry behaviors tailored to Meta's API specifications, and cleanly isolates architectural boundaries.

---

## ADR-022: H0 Final Closeout & Release Gate — Production Fail-Closed Administrative Separation, Provider Protocol Integrity, and Outbox Invariant Verification

- **Date:** 2026-09-20
- **Status:** APPROVED [IMPLEMENTED]
- **Context:** Final engineering review of PR #1 and the H0 foundation identified two critical vulnerabilities prior to release gating:
  1. _Role Provisioning & Production Migrator Connection Leak:_ `scripts/provision-db-roles.ts` performed privileged administrative DDL (`CREATE ROLE`, `ALTER ROLE`, `GRANT`, `REVOKE`) using the runtime application `pool` instead of `migratorPool`. Furthermore, `migratorPool` in `packages/database/src/client.ts` silently fell back to the runtime `DATABASE_URL` even when `NODE_ENV === "production"`, creating a risk of administrative commands running over least-privilege runtime connections or failing to enforce administrative separation in deployment environments.
  2. _Fabricated Provider WAMID on Malformed 200 OK Responses:_ In `DefaultWhatsAppApiClient`, if Meta Graph API returned HTTP 200 OK with an empty or missing `messages[0].id`, the client silently fabricated a random local identifier (`wamid.<random>`). This created false provider confirmation state in the database, marked messages `SENT` and outbox events `COMPLETED`, and made future webhook delivery/read reconciliation impossible.
- **Decision:**
  1. **Strict Administrative Connection Routing in Role Provisioning:**
     Updated `scripts/provision-db-roles.ts` to connect exclusively via `migratorPool` (or an explicitly provided administrative client). The runtime application connection `pool` is never used for role management.
  2. **Production Fail-Closed Lazy Migrator Pool:**
     Refactored `migratorPool` in `packages/database/src/client.ts` to be lazily evaluated via a Proxy. In development and testing (`NODE_ENV !== "production"`), it permits fallback to `DATABASE_URL` for developer convenience. In production (`NODE_ENV === "production"`), attempting to acquire a client from `migratorPool` without `MIGRATOR_DATABASE_URL` explicitly configured immediately throws a fatal configuration error, preventing silent fallback to runtime credentials. Documented both connection strings clearly in `deploy/env.prod.example`.
  3. **Zero Fake WAMID Generation (Terminal Provider Protocol Error):**
     In `DefaultWhatsAppApiClient`, a 200 OK response lacking a valid string `messages[0].id` is treated as a terminal provider protocol failure and throws `WhatsAppApiError(..., 200, false, false)`. `handleWhatsAppOutboundEvent` transitions the message to `FAILED` and exhausts outbox retries via `TerminalOutboxError`. Zero locally fabricated provider identifiers are accepted into the database.
  4. **H0 Foundation Release Gate Sign-Off:**
     Conducted a comprehensive 15-point failure mode audit (Scenarios A through O) across manual WhatsApp dispatch, Smart Rules automation, concurrent idempotency, transactional outbox rollback, and crash recovery. All 29 test suites (269 tests) pass with 100% CI coverage.
- **Rationale:** Guarantees absolute architectural integrity between runtime and administrative database connections, enforces strict fail-closed production deployment contracts, eliminates false provider confirmation states, and ensures the H0 foundation carries zero known P0/P1 defects into application-layer development.

---

### ADR-023: Phase 22 — Real Estate Domain Model Refinement, 1:N Property Interests, and Reservation Hardening

- **Date:** 2026-09-21
- **Status:** APPROVED [IMPLEMENTED]
- **Context:**
  Following the architectural review of the Phase 22 prototype, the human owner approved Phase 22 with key amendments to eliminate conceptual redundancy and harden data integrity:
  1. **Units Domain Redundancy:** The prototype introduced `category` alongside `unit_type`. This was resolved by establishing `usage_type` (controlled business classification: `RESIDENTIAL`, `COMMERCIAL`, `ADMINISTRATIVE`, `MEDICAL`) and `unit_type` (standardized physical product taxonomy: `APARTMENT`, `CLINIC`, `RETAIL_STORE`, etc.), with optional `model_name` as a developer-specific label. Prototype `category` was completely eliminated.
  2. **1:N Property Interests:** Flat interest columns on `leads` were replaced with a dedicated `lead_property_interests` table, allowing clients to hold multiple requirement profiles (wishlists). Includes composite foreign keys `(organization_id, ...)` with `ON DELETE RESTRICT` for project and unit references, a partial unique index ensuring at most one primary active interest per lead, and database CHECK constraints for budget and area ranges (`budget_min <= budget_max`, `area_min <= area_max`).
  3. **Decoupled Project Lifecycles:** Separated physical construction progress (`construction_status`: `PLANNING`, `UNDER_CONSTRUCTION`, `READY_FOR_DELIVERY`, `COMPLETED`) from commercial sales activity (`sales_status`: `UPCOMING`, `SELLING`, `SOLD_OUT`, `RENTAL_ONLY`, `ON_HOLD`), with `is_active` serving strictly as an administrative visibility/archive flag.
  4. **Payment Plan Engine Hardening:** Integer piastre arithmetic ($1\text{ EGP} = 100\text{ piastres}$) with exact equality invariant ($\text{down payment} + \text{installments} + \text{delivery} = \text{unit contract price}$), month-end date clamping (preventing Jan 31 $\to$ March 3 rollover), and configurable maintenance line-item separation.
  5. **Reservation Expiration Lifecycle:**
     - **Protection A (Just-In-Time):** In the reservation transaction, lock unit, detect expired reservation (`expires_at < NOW()`), atomically mark `EXPIRED`, restore unit to `AVAILABLE`, and evaluate new reservation.
     - **Protection B (Scheduled Sweeper):** Periodic, idempotent sweeper releasing expired reservations (`expireStaleReservations` and `sweepExpiredReservations`).
     - Concurrency protection via `SELECT ... FOR UPDATE` + partial unique index `WHERE status IN ('CONFIRMED', 'PENDING')`.
- **Decision:**
  1. **Schema Evolution (Migrations 0019 & 0020):**
     - Migration 0019 (`0019_h0_public_schema_create_revoke.sql`): Strict least-privilege DDL restrictions on public schema (`REVOKE CREATE ON SCHEMA public FROM PUBLIC, app_user`).
     - Migration 0020 (`0020_phase22_real_estate_domain_and_interest.sql`):
       - Updated `projects` table with `project_type`, `construction_status`, `sales_status`, and `is_active`.
       - Updated `units` table with `usage_type`, `unit_type`, `model_name`, `floor`, and `is_active`.
       - Created `lead_property_interests` table with composite tenant foreign keys, range CHECK constraints, and partial unique index `idx_lead_primary_active_interest`.
       - Implemented partial unique index `idx_active_unit_reservation` on `reservations (organization_id, unit_id) WHERE status IN ('CONFIRMED', 'PENDING')`.
  2. **Core Domain Services & Authorization Hardening (`packages/types`, `packages/core`):**
     - Defined `ConstructionStatusSchema`, `SalesStatusSchema`, `UnitUsageTypeSchema`, `UnitTypeSchema`, and `LeadPropertyInterestSchema`.
     - Enforced strict Lead row-level ownership in `lead-property-interest-service.ts`: SALESPERSON can only access and mutate interests for leads assigned to them; MARKETING_USER is strictly aggregate-only (forbidden from individual interests).
     - Enforced domain consistency in `addLeadInterest` and `updateLeadInterest`: specific unit must belong to tenant and to the specified project.
     - Preserved `projects.total_units` as authoritative declared capacity without dynamic increments in `createUnit()`.
     - Enforced `downPaymentPercent + deliveryPaymentPercent < 100` and strictly positive installments in `payment-plan-service.ts`, with full support for `SEMI_ANNUAL`, `ANNUAL`, leap-year Feb 29 transitions, and month-end clamping.
     - Hardened `reservation-service.ts`:
       - Checked individual lead ownership before reserving inventory.
       - Enforced uniform lock order (`units` first, `reservations` second) across `createReservation` and `expireStaleReservations` to prevent deadlocks.
       - Hardened JIT expiration so units marked `CONTRACTED` or `BLOCKED` are never reopened to `AVAILABLE` by stale reservations.
  3. **Deterministic Lead Matching Engine (`read-models.ts`):**
     - Enforced row-level lead ownership in `getLeadMatchedUnits(context, leadId)`.
     - Ranked inventory strictly on property matching rules with deterministic tie-breaking (no customer-value scoring).
  4. **Prohibition of Fabricated Pilot Facts (`packages/core/src/pilot/seed-data.ts`):**
     - Replaced all invented pilot metadata with strictly synthetic fixtures (`Test Project Alpha`, `Test Residential Project Beta`, `Test Unit A-101`, synthetic customer identities).
  5. **Tactile Taste-Skill Frontend Implementation (`apps/web`):**
     - **Projects Portfolio (`/app/projects`):** Decoupled construction and sales status badges, active indicators, and `CreateProjectDialog`.
     - **Property Inventory (`/app/units`):** Development, usage type, unit type, and status filter toolbar, `CreateUnitDialog`, and `PaymentPlanModal`.
     - **Lead Detail Workspace (`/app/leads/[id]`):** 1:N `LeadInterestCard` wishlist with primary badges, add interest dialog, and matched units with instant reservation and payment plan modals.
  6. **Automated Verification:**
     - 34 test files (345 tests) passing 100%.
     - Playwright browser E2E (9 passed, 1 skipped) and Visual QA (1 passed) passing 100%.
     - Strict TypeScript typecheck (`tsc --noEmit`), Next.js production build, and Prettier clean.
- **Rationale:** Delivers complete, production-hardened real estate inventory, wishlist matching, and financial lifecycle capabilities while maintaining absolute multi-tenant isolation, authorization safety, and strict architectural discipline.


---

### ADR-024: Phase 23A — Sales Pipeline Integrity and Task-Based Next Action

- **Date:** 2026-09-21
- **Status:** APPROVED [IN PROGRESS]
- **Context:** Phase 22 established the real-estate domain, but the CRM still allowed operational gaps: lead stage changes had no structured history, lost leads lacked consistent closure reasons, and “next action” risked becoming a second duplicated field beside the existing Tasks domain. The product also needs an explicit sales module that can evolve independently from CRM primitives.
- **Decision:**
  1. **Tasks are the authoritative Next Action source:** The earliest incomplete Task attached to a Lead is treated as that Lead's next action. No separate `next_action_at` or `next_action_title` columns are introduced on `leads`.
  2. **Structured pipeline lifecycle metadata:** Leads gain `pipeline_stage_entered_at`, `lost_reason_code`, `lost_reason_notes`, and `closed_at`.
  3. **Structured stage history:** `lead_stage_history` records pipeline transitions with tenant-safe composite foreign keys and RLS. Runtime access is least-privilege (`SELECT` + `INSERT` only).
  4. **Logical manual transition guard:** User-driven stage updates are constrained to valid sales-flow transitions, preventing impossible jumps such as `NEW -> CONTRACTED`.
  5. **Structured closure reasons:** Lost and unqualified leads capture controlled reason codes, enabling future loss analytics without free-text-only ambiguity.
  6. **Dedicated Sales module:** Anti-lead-leakage read models live under `packages/core/src/sales`, keeping higher-level sales execution logic separate from lower-level CRM entity services.
  7. **Role-aware follow-up health:** The system derives `NO_NEXT_ACTION`, `OVERDUE_NEXT_ACTION`, `STALE_CONTACT`, or `HEALTHY` from existing lead/task data while preserving SALESPERSON assignment scoping.
- **Rationale:** Prevents duplicate sources of truth, creates measurable pipeline history, enables manager anti-leakage views, and establishes a modular sales boundary that can accept future SLA, forecasting, automation, and AI-assist features without restructuring the CRM core.
