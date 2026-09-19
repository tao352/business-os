-- ==============================================================================
-- MIGRATION 0003: CRM CORE ENTITIES (ACTIVITIES, TASKS & DEALS)
-- ==============================================================================

-- 1. Activities (Timeline of calls, messages, notes, and status changes)
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL, -- 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE', 'STATUS_CHANGE'
  summary VARCHAR(255) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_org_lead ON activities(organization_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_org_user ON activities(organization_id, user_id);

-- 2. Tasks (Follow-up reminders with deadlines and completion tracking)
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  assigned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'URGENT'
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_org_assigned ON tasks(organization_id, assigned_user_id, is_completed, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_org_lead ON tasks(organization_id, lead_id);

-- 3. Deals (Commercial pipeline opportunities)
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  stage VARCHAR(50) NOT NULL DEFAULT 'DISCOVERY', -- 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'
  expected_close_date DATE,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  custom_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_org_stage ON deals(organization_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_org_lead ON deals(organization_id, lead_id);

-- ==============================================================================
-- 4. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL NEW TABLES
-- ==============================================================================

-- Activities RLS
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_activities ON activities;
CREATE POLICY tenant_isolation_activities ON activities
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Tasks RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tasks ON tasks;
CREATE POLICY tenant_isolation_tasks ON tasks
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Deals RLS
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_deals ON deals;
CREATE POLICY tenant_isolation_deals ON deals
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to app_user role
GRANT ALL PRIVILEGES ON TABLE activities TO app_user;
GRANT ALL PRIVILEGES ON TABLE tasks TO app_user;
GRANT ALL PRIVILEGES ON TABLE deals TO app_user;
