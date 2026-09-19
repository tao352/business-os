# INTEGRATION ARCHITECTURE & CONNECTORS

## 1. Isolation Principle

External integrations (Meta, WhatsApp, Google, Webhooks) are **untrusted, volatile third-party systems**. A failure or rate-limit spike from Meta must never block, crash, or degrade core CRM operations.

---

## 2. Webhook Ingress Architecture

1. **Public Webhook Endpoint (`apps/web/app/api/webhooks/[provider]/route.ts`):**
   - Verifies cryptographic HMAC SHA-256 signature using the provider's secret key.
   - Immediately validates the payload format.
   - Stores the raw payload in Redis / S3 buffer and enqueues a sync job to BullMQ.
   - Returns `200 OK` in `< 150ms`.
2. **Asynchronous Worker Processor (`apps/worker/processors/webhook-ingest.ts`):**
   - De-duplicates the payload via `idempotency_key`.
   - Maps provider fields (e.g. Meta form field IDs) to tenant lead fields.
   - Inserts the record within the appropriate `withTenantContext`.
   - Emits internal `lead.created` event for Smart Rules processing.

---

## 3. Supported Initial Connectors

### Meta Lead Ads (Facebook & Instagram)

- **Direct Webhook Subscription:** Listens for `leadgen` events on tenant Facebook Pages.
- **Cryptographic Security:** Verifies incoming `X-Hub-Signature-256` using constant-time HMAC-SHA256 (`crypto.timingSafeEqual`).
- **Webhook Handshake:** Responds to Meta verification challenge queries (`hub.mode === 'subscribe'`, `hub.verify_token`, `hub.challenge`).
- **Idempotency Registry (`webhook_events`):** Stores incoming events with a unique constraint on `(organization_id, provider, event_id)` to guarantee zero duplicate lead entries upon webhook retries.
- **Full Attribution Ingestion:** Captures Campaign ID, Campaign Name, Ad Set ID, Ad ID, Ad Name, and Form ID directly into `leads.campaign_id` and `leads.custom_data.meta_attribution`.
- **Deduplication Strategy:** Incoming leads matching existing contacts by phone number automatically update the lead and append a timeline activity note, avoiding database fragmentation.
- **Custom Question Mapping:** Dynamically parses non-standard form questions and preserves them in `custom_data` or maps them to tenant custom fields.
- **Server-Side Conversions API (CAPI):** Dispatches offline milestone events (Lead Qualified, Site Visit Booked, Contract Signed) back to Meta to optimize ad bidding algorithms.

### WhatsApp Cloud API (Meta Official BSP)

- **Official Cloud API Integration:** Avoids brittle, unofficial QR-code scrapers.
- **Template Management:** Supports pre-approved Meta message templates with dynamic variable insertion.
- **Two-Way Messaging Timeline:** Incoming WhatsApp messages from prospective buyers automatically append to the lead's activity timeline in real-time.
