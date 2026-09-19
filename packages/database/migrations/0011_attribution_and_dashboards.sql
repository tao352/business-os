-- ==============================================================================
-- MIGRATION 0011: MARKETING ATTRIBUTION & EXECUTIVE DASHBOARDS
-- ==============================================================================

-- 1. Campaign Spend Logs (Tracking marketing spend for ROAS and CAC)
CREATE TABLE IF NOT EXISTS campaign_spend_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id VARCHAR(100) NOT NULL,
  campaign_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'FACEBOOK_LEAD_ADS',
  spend_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  spend_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_spend_org ON campaign_spend_logs(organization_id, campaign_id, spend_date);
CREATE INDEX IF NOT EXISTS idx_campaign_spend_source ON campaign_spend_logs(organization_id, source);

-- ==============================================================================
-- 2. ROW LEVEL SECURITY (RLS) - ZERO LEAK INVARIANT
-- ==============================================================================

ALTER TABLE campaign_spend_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_spend_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_campaign_spend_logs ON campaign_spend_logs;
CREATE POLICY tenant_isolation_campaign_spend_logs ON campaign_spend_logs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 3. GRANT PERMISSIONS TO APP_USER
-- ==============================================================================

GRANT ALL PRIVILEGES ON TABLE campaign_spend_logs TO app_user;
