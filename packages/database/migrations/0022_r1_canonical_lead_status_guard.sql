-- ==============================================================================
-- MIGRATION 0022: R1 — CANONICAL LEAD PIPELINE STATUS GUARD
-- ==============================================================================

-- Refuse to silently reinterpret unknown legacy pipeline values. If an older
-- deployment contains a non-canonical status, an operator must explicitly
-- reconcile it before this invariant can be enforced.
DO $$
DECLARE
  invalid_statuses TEXT;
BEGIN
  SELECT string_agg(DISTINCT status, ', ' ORDER BY status)
  INTO invalid_statuses
  FROM public.leads
  WHERE status NOT IN (
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'MEETING_SCHEDULED',
    'SITE_VISIT_BOOKED',
    'RESERVED',
    'CONTRACTED',
    'UNQUALIFIED',
    'LOST'
  );

  IF invalid_statuses IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0022 blocked: non-canonical lead statuses found: %. Reconcile them before retrying.',
      invalid_statuses;
  END IF;
END $$;

ALTER TABLE public.leads
  ADD CONSTRAINT chk_leads_status_r1
  CHECK (
    status IN (
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'MEETING_SCHEDULED',
      'SITE_VISIT_BOOKED',
      'RESERVED',
      'CONTRACTED',
      'UNQUALIFIED',
      'LOST'
    )
  );
