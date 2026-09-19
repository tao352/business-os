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
