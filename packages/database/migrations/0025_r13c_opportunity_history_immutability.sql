-- ==============================================================================
-- MIGRATION 0025: R1.3C — OPPORTUNITY STAGE HISTORY IMMUTABILITY
-- ==============================================================================

-- R1.3C stage history is an audit-style lifecycle ledger. Runtime grants alone
-- are not a sufficient tamper-resistance boundary because privileged database
-- actors may hold broader table privileges. Enforce append-only semantics at
-- the table boundary just like audit_logs.

CREATE OR REPLACE FUNCTION public.prevent_opportunity_stage_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Opportunity stage history is immutable. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_opportunity_stage_history_mutation
  ON public.opportunity_stage_history;

CREATE TRIGGER trg_prevent_opportunity_stage_history_mutation
BEFORE UPDATE OR DELETE ON public.opportunity_stage_history
FOR EACH ROW
EXECUTE FUNCTION public.prevent_opportunity_stage_history_mutation();
