-- ==============================================================================
-- MIGRATION 0013: H0 HARDENING — COMPOSITE TENANT FKS, OUTBOX & MIGRATIONS
-- Enforces Invariant 3.1: Complete relational-level tenant boundary isolation
-- ==============================================================================

-- 1. Migration tracking table for verified programmatic runner
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  checksum VARCHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Unique constraints on (organization_id, id) for relational parent references
ALTER TABLE projects ADD CONSTRAINT uq_projects_org_id UNIQUE (organization_id, id);
ALTER TABLE leads ADD CONSTRAINT uq_leads_org_id UNIQUE (organization_id, id);
ALTER TABLE units ADD CONSTRAINT uq_units_org_id UNIQUE (organization_id, id);
ALTER TABLE reservations ADD CONSTRAINT uq_reservations_org_id UNIQUE (organization_id, id);
ALTER TABLE deals ADD CONSTRAINT uq_deals_org_id UNIQUE (organization_id, id);

-- 3. Composite Foreign Keys preventing cross-tenant references at the relational layer

-- Units -> Projects
ALTER TABLE units
  ADD CONSTRAINT fk_units_composite_project
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id)
  ON DELETE CASCADE;

-- Visits -> Leads & Projects
ALTER TABLE visits
  ADD CONSTRAINT fk_visits_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE visits
  ADD CONSTRAINT fk_visits_composite_project
  FOREIGN KEY (organization_id, project_id)
  REFERENCES projects (organization_id, id)
  ON DELETE CASCADE;

-- Reservations -> Leads & Units
ALTER TABLE reservations
  ADD CONSTRAINT fk_reservations_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE reservations
  ADD CONSTRAINT fk_reservations_composite_unit
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES units (organization_id, id)
  ON DELETE CASCADE;

-- Contracts -> Leads, Units & Reservations
ALTER TABLE contracts
  ADD CONSTRAINT fk_contracts_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE contracts
  ADD CONSTRAINT fk_contracts_composite_unit
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES units (organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE contracts
  ADD CONSTRAINT fk_contracts_composite_reservation
  FOREIGN KEY (organization_id, reservation_id)
  REFERENCES reservations (organization_id, id)
  ON DELETE SET NULL;

-- Deals -> Leads
ALTER TABLE deals
  ADD CONSTRAINT fk_deals_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

-- Activities -> Leads
ALTER TABLE activities
  ADD CONSTRAINT fk_activities_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

-- Tasks -> Leads
ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_composite_lead
  FOREIGN KEY (organization_id, lead_id)
  REFERENCES leads (organization_id, id)
  ON DELETE CASCADE;

-- 4. Transactional Outbox Table for Asynchronous Side Effects
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(organization_id, status);

-- Enable RLS on outbox_events
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_tenant_isolation ON outbox_events
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT ALL ON outbox_events TO app_user;
