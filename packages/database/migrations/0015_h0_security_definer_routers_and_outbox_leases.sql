-- ==============================================================================
-- MIGRATION 0015: SECURITY DEFINER ROUTERS, OUTBOX LEASES & DURABLE MESSAGING
-- ==============================================================================

-- 1. Dedicated Non-Login Owner Role for Minimal Tenant Resolution Routers
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'business_os_router_owner') THEN
    CREATE ROLE business_os_router_owner WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO business_os_router_owner;
GRANT SELECT ON public.meta_integrations TO business_os_router_owner;
GRANT SELECT ON public.whatsapp_integrations TO business_os_router_owner;

-- 2. SECURITY DEFINER Meta Tenant Router
-- Resolves only organization_id + integration_id without exposing secrets or credentials
CREATE OR REPLACE FUNCTION public.resolve_meta_tenant(p_page_id VARCHAR)
RETURNS TABLE (
  organization_id UUID,
  integration_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.organization_id, m.id AS integration_id
  FROM public.meta_integrations m
  WHERE m.page_id = p_page_id
    AND m.is_active = true
  LIMIT 1;
$$;

ALTER FUNCTION public.resolve_meta_tenant(VARCHAR) OWNER TO business_os_router_owner;
REVOKE ALL ON FUNCTION public.resolve_meta_tenant(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_meta_tenant(VARCHAR) TO app_user;

-- 3. SECURITY DEFINER WhatsApp Tenant Router
-- Resolves only organization_id + integration_id without exposing secrets or credentials
CREATE OR REPLACE FUNCTION public.resolve_whatsapp_tenant(p_phone_number_id VARCHAR)
RETURNS TABLE (
  organization_id UUID,
  integration_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT w.organization_id, w.id AS integration_id
  FROM public.whatsapp_integrations w
  WHERE w.phone_number_id = p_phone_number_id
    AND w.is_active = true
  LIMIT 1;
$$;

ALTER FUNCTION public.resolve_whatsapp_tenant(VARCHAR) OWNER TO business_os_router_owner;
REVOKE ALL ON FUNCTION public.resolve_whatsapp_tenant(VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_tenant(VARCHAR) TO app_user;

-- 4. Outbox Lease & Worker Tracking
ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_outbox_events_lease
  ON public.outbox_events(status, processing_started_at);

-- 5. WhatsApp Durable Messaging States & Nullable WAMID for PENDING/SENDING
ALTER TABLE public.whatsapp_messages ALTER COLUMN wamid DROP NOT NULL;

ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_organization_id_wamid_key;
DROP INDEX IF EXISTS idx_wa_msg_org_wamid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_msg_org_wamid
  ON public.whatsapp_messages(organization_id, wamid)
  WHERE wamid IS NOT NULL;

ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS chk_wa_msg_status;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT chk_wa_msg_status
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN'));
