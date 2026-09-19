-- ==============================================================================
-- MIGRATION 0006: INTEGRATIONS & WEBHOOK EVENTS (META LEAD ADS & EXTERNAL PROVIDERS)
-- ==============================================================================

-- 1. Meta Integrations (Facebook & Instagram Lead Ads Page Configurations)
CREATE TABLE IF NOT EXISTS meta_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id VARCHAR(100) NOT NULL,
  page_name VARCHAR(255),
  page_access_token TEXT NOT NULL,
  app_secret VARCHAR(255) NOT NULL,
  verify_token VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  field_mappings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integrations_org_page ON meta_integrations(organization_id, page_id);
CREATE INDEX IF NOT EXISTS idx_meta_integrations_page_id ON meta_integrations(page_id);

-- 2. Webhook Events (Idempotency, Audit Trail & Deduplication Registry)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- 'META', 'TIKTOK', 'GOOGLE', etc.
  event_id VARCHAR(150) NOT NULL, -- Unique ID from provider (e.g., leadgen_id)
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSED', 'FAILED', 'DUPLICATE'
  error_message TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_org_provider ON webhook_events(organization_id, provider, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_lead_id ON webhook_events(organization_id, lead_id);

-- ==============================================================================
-- 3. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL TABLES
-- ==============================================================================

-- Meta Integrations RLS
ALTER TABLE meta_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_integrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_meta_integrations ON meta_integrations;
CREATE POLICY tenant_isolation_meta_integrations ON meta_integrations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Webhook Events RLS
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_webhook_events ON webhook_events;
CREATE POLICY tenant_isolation_webhook_events ON webhook_events
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to application user role
GRANT ALL PRIVILEGES ON TABLE meta_integrations TO app_user;
GRANT ALL PRIVILEGES ON TABLE webhook_events TO app_user;
