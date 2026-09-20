-- ==============================================================================
-- MIGRATION 0016: GLOBAL ACTIVE INTEGRATION UNIQUENESS
-- ==============================================================================
-- Ensures that a Meta Page ID or WhatsApp Phone Number ID cannot be actively
-- bound to more than one tenant organization simultaneously.
-- Protects SECURITY DEFINER routing functions (resolve_meta_tenant, resolve_whatsapp_tenant)
-- from cross-tenant routing ambiguity and collisions.

-- 1. Meta Integrations Platform-Wide Active Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_integrations_active_page_id
ON public.meta_integrations (page_id)
WHERE is_active = true;

-- 2. WhatsApp Integrations Platform-Wide Active Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_integrations_active_phone_id
ON public.whatsapp_integrations (phone_number_id)
WHERE is_active = true;
