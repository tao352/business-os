-- ==============================================================================
-- MIGRATION 0017: WHATSAPP IDEMPOTENCY & OUTBOX CLEANUP
-- ==============================================================================
-- 1. Adds idempotency_key column to whatsapp_messages to provide real API-level
--    idempotency for direct sends and automations without creating orphan records.
-- 2. Creates a partial unique index on (organization_id, idempotency_key) for active keys.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_msg_org_idempotency_key
  ON public.whatsapp_messages (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
