-- ==============================================================================
-- MIGRATION 0005: REAL ESTATE VERTICAL (PROJECTS, UNITS, VISITS, RESERVATIONS & CONTRACTS)
-- ==============================================================================

-- 1. Projects (Master developments & compounds)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(255) NOT NULL,
  description TEXT,
  total_units INT NOT NULL DEFAULT 0,
  custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

-- 2. Units (Inventory items & property specs)
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_number VARCHAR(50) NOT NULL,
  unit_type VARCHAR(50) NOT NULL,
  gross_area NUMERIC(10, 2) NOT NULL,
  price NUMERIC(15, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
  payment_plan_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, unit_number)
);

CREATE INDEX IF NOT EXISTS idx_units_org_project ON units(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_units_org_status ON units(organization_id, status);

-- 3. Visits (Site visits & inspections)
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scheduled_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  notes TEXT,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_org_lead ON visits(organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_visits_org_project ON visits(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_visits_org_status ON visits(organization_id, status);

-- 4. Reservations (Exclusive unit holding & deposits)
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reserved_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deposit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED',
  expires_at TIMESTAMPTZ NOT NULL,
  payment_method VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_org_lead ON reservations(organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_reservations_org_unit ON reservations(organization_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_reservations_org_status ON reservations(organization_id, status);

-- 5. Contracts (Executed purchase agreements)
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  contract_number VARCHAR(100) NOT NULL,
  contract_value NUMERIC(15, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
  payment_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  signed_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, contract_number)
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_lead ON contracts(organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org_unit ON contracts(organization_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON contracts(organization_id, status);

-- ==============================================================================
-- 6. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL 5 TABLES
-- ==============================================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_projects ON projects;
CREATE POLICY tenant_isolation_projects ON projects
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_units ON units;
CREATE POLICY tenant_isolation_units ON units
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_visits ON visits;
CREATE POLICY tenant_isolation_visits ON visits
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reservations ON reservations;
CREATE POLICY tenant_isolation_reservations ON reservations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_contracts ON contracts;
CREATE POLICY tenant_isolation_contracts ON contracts
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to app_user role
GRANT ALL PRIVILEGES ON TABLE projects TO app_user;
GRANT ALL PRIVILEGES ON TABLE units TO app_user;
GRANT ALL PRIVILEGES ON TABLE visits TO app_user;
GRANT ALL PRIVILEGES ON TABLE reservations TO app_user;
GRANT ALL PRIVILEGES ON TABLE contracts TO app_user;
