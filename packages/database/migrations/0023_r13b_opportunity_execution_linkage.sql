-- ==============================================================================
-- MIGRATION 0023: R1.3B — OPPORTUNITY ↔ REAL ESTATE EXECUTION LINKAGE
-- ==============================================================================

-- Opportunity remains a generic Sales-domain entity. Real Estate execution
-- records reference it; the Opportunity table does not acquire real-estate-only
-- columns.

-- 1. Preflight the legacy Deal/Opportunity data before enforcing canonical
-- application invariants. Never reinterpret unknown values silently.
DO $$
DECLARE
  invalid_stages TEXT;
  negative_values BIGINT;
BEGIN
  SELECT string_agg(DISTINCT stage, ', ' ORDER BY stage)
  INTO invalid_stages
  FROM public.deals
  WHERE stage NOT IN ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

  IF invalid_stages IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0023 blocked: non-canonical Opportunity stages found: %. Reconcile them before retrying.',
      invalid_stages;
  END IF;

  SELECT COUNT(*)
  INTO negative_values
  FROM public.deals
  WHERE value < 0;

  IF negative_values > 0 THEN
    RAISE EXCEPTION
      'Migration 0023 blocked: % Opportunity rows have negative value. Reconcile them before retrying.',
      negative_values;
  END IF;
END $$;

ALTER TABLE public.deals
  ADD CONSTRAINT chk_deals_stage_r13b
    CHECK (stage IN ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST')),
  ADD CONSTRAINT chk_deals_value_r13b
    CHECK (value >= 0),
  ADD CONSTRAINT uq_deals_org_id_lead
    UNIQUE (organization_id, id, lead_id);

-- 2. Add nullable linkage columns. Existing rows intentionally remain NULL.
-- Backfilling by Lead alone would fabricate truth because one Lead may own
-- multiple Opportunities.
ALTER TABLE public.reservations
  ADD COLUMN opportunity_id UUID;

ALTER TABLE public.contracts
  ADD COLUMN opportunity_id UUID;

-- 3. Tenant + Lead safe Opportunity references.
ALTER TABLE public.reservations
  ADD CONSTRAINT fk_reservations_tenant_opportunity
    FOREIGN KEY (organization_id, opportunity_id, lead_id)
    REFERENCES public.deals (organization_id, id, lead_id)
    ON DELETE RESTRICT;

ALTER TABLE public.contracts
  ADD CONSTRAINT fk_contracts_tenant_opportunity
    FOREIGN KEY (organization_id, opportunity_id, lead_id)
    REFERENCES public.deals (organization_id, id, lead_id)
    ON DELETE RESTRICT;

-- 4. When both Reservation and Opportunity are present on a Contract, enforce
-- that they refer to the same linkage. Contracts without a Reservation remain
-- valid, and legacy rows with NULL Opportunity remain valid.
ALTER TABLE public.reservations
  ADD CONSTRAINT uq_reservations_org_id_opportunity
    UNIQUE (organization_id, id, opportunity_id);

ALTER TABLE public.contracts
  ADD CONSTRAINT fk_contracts_reservation_opportunity
    FOREIGN KEY (organization_id, reservation_id, opportunity_id)
    REFERENCES public.reservations (organization_id, id, opportunity_id)
    ON DELETE RESTRICT;

CREATE INDEX idx_reservations_org_opportunity
  ON public.reservations (organization_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX idx_contracts_org_opportunity
  ON public.contracts (organization_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;
