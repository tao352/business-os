-- ==============================================================================
-- MIGRATION 0024: R1.3C — OPPORTUNITY LIFECYCLE & STAGE HISTORY
-- ==============================================================================

-- Opportunity lifecycle metadata is additive. Existing rows intentionally keep
-- unknown historical timestamps/reasons as NULL; do not infer them from
-- updated_at or Lead lifecycle data.
ALTER TABLE public.deals
  ADD COLUMN stage_entered_at TIMESTAMPTZ,
  ADD COLUMN closed_at TIMESTAMPTZ,
  ADD COLUMN lost_reason_code VARCHAR(50),
  ADD COLUMN lost_reason_notes TEXT;

ALTER TABLE public.deals
  ADD CONSTRAINT chk_deals_lost_reason_code_r13c
    CHECK (
      lost_reason_code IS NULL OR lost_reason_code IN (
        'PRICE',
        'FINANCING',
        'TIMING',
        'COMPETITOR',
        'NO_RESPONSE',
        'AVAILABILITY',
        'REQUIREMENTS_MISMATCH',
        'CUSTOMER_WITHDREW',
        'DUPLICATE',
        'OTHER'
      )
    );

CREATE INDEX idx_deals_pipeline_health_r13c
  ON public.deals (
    organization_id,
    stage,
    assigned_user_id,
    stage_entered_at
  );

-- Immutable-style Opportunity stage history. The physical parent table remains
-- deals during the compatibility phase, while application code uses Opportunity
-- terminology.
CREATE TABLE public.opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL,
  from_stage VARCHAR(50),
  to_stage VARCHAR(50) NOT NULL,
  changed_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  transition_source VARCHAR(50) NOT NULL,
  reason_code VARCHAR(50),
  reason_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_opportunity_stage_history_org_id
    UNIQUE (organization_id, id),

  CONSTRAINT fk_opportunity_stage_history_tenant_opportunity
    FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.deals (organization_id, id)
    ON DELETE CASCADE,

  CONSTRAINT chk_opportunity_stage_history_from_stage
    CHECK (
      from_stage IS NULL OR from_stage IN (
        'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'
      )
    ),

  CONSTRAINT chk_opportunity_stage_history_to_stage
    CHECK (
      to_stage IN (
        'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'
      )
    ),

  CONSTRAINT chk_opportunity_stage_history_reason_code
    CHECK (
      reason_code IS NULL OR reason_code IN (
        'PRICE',
        'FINANCING',
        'TIMING',
        'COMPETITOR',
        'NO_RESPONSE',
        'AVAILABILITY',
        'REQUIREMENTS_MISMATCH',
        'CUSTOMER_WITHDREW',
        'DUPLICATE',
        'OTHER'
      )
    )
);

CREATE INDEX idx_opportunity_stage_history_opportunity_r13c
  ON public.opportunity_stage_history (
    organization_id,
    opportunity_id,
    created_at DESC
  );

-- Establish a truthful baseline for pre-R1.3C Opportunities. This records only
-- the stage that exists at migration time. It does NOT claim when that stage
-- began and therefore leaves deals.stage_entered_at / closed_at untouched.
INSERT INTO public.opportunity_stage_history (
  organization_id,
  opportunity_id,
  from_stage,
  to_stage,
  changed_by_user_id,
  transition_source,
  metadata,
  created_at
)
SELECT
  d.organization_id,
  d.id,
  NULL,
  d.stage,
  NULL,
  'r13c_baseline',
  '{"source":"r13c_baseline"}'::jsonb,
  NOW()
FROM public.deals d;

ALTER TABLE public.opportunity_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_stage_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_opportunity_stage_history
  ON public.opportunity_stage_history
  FOR ALL
  USING (
    organization_id =
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id =
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- Runtime callers may append/read history but cannot mutate or delete it.
REVOKE ALL ON TABLE public.opportunity_stage_history FROM app_user;
GRANT SELECT, INSERT ON TABLE public.opportunity_stage_history TO app_user;
