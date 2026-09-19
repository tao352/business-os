-- ==============================================================================
-- MIGRATION 0009: SCHEDULED JOBS & TIME-BASED AUTOMATION LOGS
-- ==============================================================================

-- 1. Scheduled Job Runs (Audit trail for background evaluations and time-based triggers)
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL, -- 'INACTIVITY_CHECK', 'RESERVATION_EXPIRING_CHECK', 'TASK_DUE_CHECK', 'ALL_SCANNERS'
  entities_evaluated INT NOT NULL DEFAULT 0,
  rules_triggered INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'FAILED', 'PARTIAL'
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sched_jobs_org_type ON scheduled_job_runs(organization_id, job_type, started_at DESC);

-- ==============================================================================
-- 2. ENABLE ROW-LEVEL SECURITY (RLS)
-- ==============================================================================

ALTER TABLE scheduled_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_job_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_scheduled_job_runs ON scheduled_job_runs;
CREATE POLICY tenant_isolation_scheduled_job_runs ON scheduled_job_runs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to application user role
GRANT ALL PRIVILEGES ON TABLE scheduled_job_runs TO app_user;
