-- ==============================================================================
-- MIGRATION 0021: PHASE 23A — SALES PIPELINE INTEGRITY & ANTI-LEAD-LEAKAGE
-- ==============================================================================

-- 1. Add structured pipeline lifecycle metadata to Leads.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lost_reason_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lost_reason_notes TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Existing closed leads predate structured closure reasons. Preserve them truthfully
-- instead of inventing a business reason.
UPDATE public.leads
SET lost_reason_code = COALESCE(lost_reason_code, 'UNSPECIFIED'),
    closed_at = COALESCE(closed_at, updated_at)
WHERE status IN ('LOST', 'UNQUALIFIED');

ALTER TABLE public.leads
  ADD CONSTRAINT chk_leads_lost_reason_code_phase23
  CHECK (
    lost_reason_code IS NULL OR lost_reason_code IN (
      'PRICE',
      'FINANCING',
      'UNIT_NOT_AVAILABLE',
      'LOCATION',
      'TIMING',
      'COMPETITOR',
      'NO_RESPONSE',
      'NOT_QUALIFIED',
      'DUPLICATE',
      'OTHER',
      'UNSPECIFIED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_health
  ON public.leads (
    organization_id,
    status,
    assigned_user_id,
    pipeline_stage_entered_at,
    last_contacted_at
  );

-- 2. Immutable-style structured history of Lead pipeline transitions.
CREATE TABLE IF NOT EXISTS public.lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  changed_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason_code VARCHAR(50),
  reason_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_lead_stage_history_org_id UNIQUE (organization_id, id),

  CONSTRAINT fk_lead_stage_history_tenant_lead
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES public.leads (organization_id, id)
    ON DELETE CASCADE,

  CONSTRAINT chk_lead_stage_history_from_status
    CHECK (
      from_status IS NULL OR from_status IN (
        'NEW','CONTACTED','QUALIFIED','MEETING_SCHEDULED','SITE_VISIT_BOOKED',
        'RESERVED','CONTRACTED','UNQUALIFIED','LOST'
      )
    ),

  CONSTRAINT chk_lead_stage_history_to_status
    CHECK (
      to_status IN (
        'NEW','CONTACTED','QUALIFIED','MEETING_SCHEDULED','SITE_VISIT_BOOKED',
        'RESERVED','CONTRACTED','UNQUALIFIED','LOST'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead
  ON public.lead_stage_history (organization_id, lead_id, created_at DESC);

-- Establish a truthful baseline for pre-Phase-23 leads. No actor or invented
-- historical reason is assigned because that information is unknown.
INSERT INTO public.lead_stage_history (
  organization_id,
  lead_id,
  from_status,
  to_status,
  changed_by_user_id,
  metadata,
  created_at
)
SELECT
  l.organization_id,
  l.id,
  NULL,
  l.status,
  NULL,
  '{"source":"phase23_baseline"}'::jsonb,
  NOW()
FROM public.leads l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lead_stage_history h
  WHERE h.organization_id = l.organization_id
    AND h.lead_id = l.id
);

-- 3. Tenant isolation and least-privilege runtime access.
ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_stage_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_lead_stage_history ON public.lead_stage_history;
CREATE POLICY tenant_isolation_lead_stage_history ON public.lead_stage_history
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

REVOKE ALL ON TABLE public.lead_stage_history FROM app_user;
GRANT SELECT, INSERT ON TABLE public.lead_stage_history TO app_user;
