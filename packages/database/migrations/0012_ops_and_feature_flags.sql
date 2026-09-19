-- Migration: 0012_ops_and_feature_flags.sql
-- Description: Creates feature_flags and tenant_incident_logs with multi-tenant RLS

-- 1. Feature Flags Table (Platform-wide and Tenant-targeted)
CREATE TABLE IF NOT EXISTS feature_flags (
  key VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  enabled_globally BOOLEAN NOT NULL DEFAULT false,
  target_tenants UUID[] NOT NULL DEFAULT '{}',
  percentage INTEGER NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);

-- 2. Tenant Incident Logs Table
CREATE TABLE IF NOT EXISTS tenant_incident_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity VARCHAR(50) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title VARCHAR(255) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
  correlation_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_incident_logs_org_status ON tenant_incident_logs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_incident_logs_created ON tenant_incident_logs(created_at DESC);

-- 3. Row-Level Security for Tenant Incidents
ALTER TABLE tenant_incident_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_incident_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_incident_logs_isolation_policy ON tenant_incident_logs;
CREATE POLICY tenant_incident_logs_isolation_policy ON tenant_incident_logs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 4. Grant Permissions to app_user
GRANT ALL PRIVILEGES ON TABLE feature_flags TO app_user;
GRANT ALL PRIVILEGES ON TABLE tenant_incident_logs TO app_user;
