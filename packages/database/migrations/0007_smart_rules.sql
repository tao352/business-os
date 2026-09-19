-- ==============================================================================
-- MIGRATION 0007: SMART RULES AUTOMATION ENGINE (TCA: TRIGGER-CONDITION-ACTION)
-- ==============================================================================

-- 1. Automation Rules (Pre-validated TCA definitions)
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  trigger_type VARCHAR(50) NOT NULL, -- 'lead.created', 'lead.status_changed', 'task.due', etc.
  conditions JSONB NOT NULL DEFAULT '[]', -- array of { field, operator, value }
  actions JSONB NOT NULL DEFAULT '[]', -- array of { action_type, params, delay_seconds }
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  execution_count INT NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_org_trigger ON automation_rules(organization_id, trigger_type, is_active);

-- 2. Rule Executions (Immutable Audit Trail of rule firings)
CREATE TABLE IF NOT EXISTS rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  trigger_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'lead', 'task', etc.
  entity_id UUID NOT NULL,
  actions_executed JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'SKIPPED'
  error_message TEXT,
  execution_duration_ms INT NOT NULL DEFAULT 0,
  hop_depth INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_exec_org_rule ON rule_executions(organization_id, rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_exec_org_entity ON rule_executions(organization_id, entity_id);

-- 3. Round-Robin State Registry (Tracks last assigned user per rule/team)
CREATE TABLE IF NOT EXISTS round_robin_state (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  last_assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, rule_id)
);

-- ==============================================================================
-- 4. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL TABLES
-- ==============================================================================

-- Automation Rules RLS
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_automation_rules ON automation_rules;
CREATE POLICY tenant_isolation_automation_rules ON automation_rules
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Rule Executions RLS
ALTER TABLE rule_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_rule_executions ON rule_executions;
CREATE POLICY tenant_isolation_rule_executions ON rule_executions
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Round-Robin State RLS
ALTER TABLE round_robin_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_robin_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_round_robin_state ON round_robin_state;
CREATE POLICY tenant_isolation_round_robin_state ON round_robin_state
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to application user role
GRANT ALL PRIVILEGES ON TABLE automation_rules TO app_user;
GRANT ALL PRIVILEGES ON TABLE rule_executions TO app_user;
GRANT ALL PRIVILEGES ON TABLE round_robin_state TO app_user;
