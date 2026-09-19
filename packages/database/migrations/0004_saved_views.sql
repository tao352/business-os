-- ==============================================================================
-- MIGRATION 0004: SAVED VIEWS & VIRTUALIZED DATA TABLES CONFIG
-- ==============================================================================

CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL, -- 'leads', 'deals', 'tasks', 'units', 'projects'
  name VARCHAR(100) NOT NULL,
  description TEXT,
  filter_ast JSONB NOT NULL DEFAULT '{"logical":"AND","conditions":[]}'::jsonb,
  sort_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  columns_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_org_entity ON saved_views(organization_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_saved_views_org_user ON saved_views(organization_id, user_id);

-- Row Level Security (RLS)
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_saved_views ON saved_views;
CREATE POLICY tenant_isolation_saved_views ON saved_views
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to app_user role
GRANT ALL PRIVILEGES ON TABLE saved_views TO app_user;
