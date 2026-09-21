-- ==============================================================================
-- MIGRATION 0020: PHASE 22 — REAL ESTATE CORE DOMAIN, INVENTORY & 1:N INTERESTS
-- ==============================================================================

-- 1. Projects Domain Expansion (Decoupled Construction & Sales Lifecycles)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_type VARCHAR(50) NOT NULL DEFAULT 'COMMERCIAL',
  ADD COLUMN IF NOT EXISTS construction_status VARCHAR(50) NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
  ADD COLUMN IF NOT EXISTS sales_status VARCHAR(50) NOT NULL DEFAULT 'SELLING',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_projects_org_status
  ON public.projects (organization_id, is_active, sales_status, construction_status);

-- 2. Units Operational Inventory Expansion (Standardized Business Use & Physical Typology)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS usage_type VARCHAR(50) NOT NULL DEFAULT 'COMMERCIAL',
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS floor VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
DECLARE invalid_values TEXT;
BEGIN
  SELECT string_agg(DISTINCT unit_type, ', ' ORDER BY unit_type) INTO invalid_values
  FROM public.units
  WHERE UPPER(REPLACE(TRIM(unit_type), '-', '_')) NOT IN (
    'APARTMENT','DUPLEX','PENTHOUSE','STUDIO','STANDALONE_VILLA','STANDALONE VILLA','VILLA',
    'TWIN_HOUSE','TWIN HOUSE','TWINHOUSE','TOWNHOUSE','TOWN_HOUSE','TOWN HOUSE',
    'RETAIL_STORE','RETAIL STORE','SHOP','STORE','RETAIL','RESTAURANT_CAFE','RESTAURANT CAFE',
    'PHARMACY','KIOSK','OFFICE','CLINIC','LABORATORY','LAB','OTHER',
    'COMMERCIAL','RESIDENTIAL','ADMINISTRATIVE','MEDICAL'
  );
  IF invalid_values IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 22 unit taxonomy migration requires manual mapping for legacy unit_type values: %', invalid_values;
  END IF;
END $$;

UPDATE public.units
SET usage_type = CASE
      WHEN UPPER(REPLACE(TRIM(unit_type), '-', '_')) IN ('APARTMENT','DUPLEX','PENTHOUSE','STUDIO','STANDALONE_VILLA','STANDALONE VILLA','VILLA','TWIN_HOUSE','TWIN HOUSE','TWINHOUSE','TOWNHOUSE','TOWN_HOUSE','TOWN HOUSE','RESIDENTIAL') THEN 'RESIDENTIAL'
      WHEN UPPER(REPLACE(TRIM(unit_type), '-', '_')) IN ('CLINIC','LABORATORY','LAB','PHARMACY','MEDICAL') THEN 'MEDICAL'
      WHEN UPPER(REPLACE(TRIM(unit_type), '-', '_')) IN ('OFFICE','ADMINISTRATIVE') THEN 'ADMINISTRATIVE'
      ELSE 'COMMERCIAL'
    END,
    unit_type = CASE UPPER(REPLACE(TRIM(unit_type), '-', '_'))
      WHEN 'VILLA' THEN 'STANDALONE_VILLA'
      WHEN 'STANDALONE VILLA' THEN 'STANDALONE_VILLA'
      WHEN 'TWIN HOUSE' THEN 'TWIN_HOUSE'
      WHEN 'TWINHOUSE' THEN 'TWIN_HOUSE'
      WHEN 'TOWN HOUSE' THEN 'TOWNHOUSE'
      WHEN 'TOWN_HOUSE' THEN 'TOWNHOUSE'
      WHEN 'RETAIL STORE' THEN 'RETAIL_STORE'
      WHEN 'SHOP' THEN 'RETAIL_STORE'
      WHEN 'STORE' THEN 'RETAIL_STORE'
      WHEN 'RETAIL' THEN 'RETAIL_STORE'
      WHEN 'RESTAURANT CAFE' THEN 'RESTAURANT_CAFE'
      WHEN 'LAB' THEN 'LABORATORY'
      WHEN 'COMMERCIAL' THEN 'OTHER'
      WHEN 'RESIDENTIAL' THEN 'OTHER'
      WHEN 'ADMINISTRATIVE' THEN 'OTHER'
      WHEN 'MEDICAL' THEN 'OTHER'
      ELSE UPPER(REPLACE(TRIM(unit_type), '-', '_'))
    END;

ALTER TABLE public.units
  ADD CONSTRAINT chk_units_usage_type_phase22 CHECK (usage_type IN ('RESIDENTIAL','COMMERCIAL','ADMINISTRATIVE','MEDICAL')),
  ADD CONSTRAINT chk_units_unit_type_phase22 CHECK (unit_type IN ('APARTMENT','DUPLEX','PENTHOUSE','STUDIO','STANDALONE_VILLA','TWIN_HOUSE','TOWNHOUSE','RETAIL_STORE','RESTAURANT_CAFE','PHARMACY','KIOSK','OFFICE','CLINIC','LABORATORY','OTHER'));

CREATE INDEX IF NOT EXISTS idx_units_inventory_lookup
  ON public.units (organization_id, project_id, usage_type, unit_type, status);

-- 3. Lead Property Interests (1:N Domain Table)
CREATE TABLE IF NOT EXISTS public.lead_property_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  project_id UUID,
  specific_unit_id UUID,
  usage_type VARCHAR(50),
  unit_type VARCHAR(50),
  budget_min NUMERIC(15, 2),
  budget_max NUMERIC(15, 2),
  area_min NUMERIC(10, 2),
  area_max NUMERIC(10, 2),
  preferred_floors TEXT[],
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_lead_interests_org_id UNIQUE (organization_id, id),

  -- Composite Tenant-Safe Foreign Keys with ON DELETE RESTRICT for historical business references
  CONSTRAINT fk_interests_tenant_lead
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES public.leads (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_interests_tenant_project
    FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_interests_tenant_unit
    FOREIGN KEY (organization_id, specific_unit_id)
    REFERENCES public.units (organization_id, id)
    ON DELETE RESTRICT,

  -- Database Range CHECK Constraints
  CONSTRAINT chk_interest_budget_min
    CHECK (budget_min IS NULL OR budget_min >= 0),
  CONSTRAINT chk_interest_budget_max
    CHECK (budget_max IS NULL OR budget_max >= 0),
  CONSTRAINT chk_interest_budget_range
    CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  CONSTRAINT chk_interest_area_min
    CHECK (area_min IS NULL OR area_min > 0),
  CONSTRAINT chk_interest_area_max
    CHECK (area_max IS NULL OR area_max > 0),
  CONSTRAINT chk_interest_area_range
    CHECK (area_min IS NULL OR area_max IS NULL OR area_min <= area_max)
);

-- Invariant: At most one primary ACTIVE interest per lead at any time
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_primary_active_interest
  ON public.lead_property_interests (organization_id, lead_id)
  WHERE status = 'ACTIVE' AND is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_lead_interests_matching
  ON public.lead_property_interests (organization_id, status, usage_type, project_id);

-- RLS Enforcement for lead_property_interests (Invariant 3.1)
ALTER TABLE public.lead_property_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_property_interests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_lead_property_interests ON public.lead_property_interests;
CREATE POLICY tenant_isolation_lead_property_interests ON public.lead_property_interests
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_property_interests TO app_user;

-- 4. Database-Level Reservation Concurrency Protection (Prevent Double-Booking)
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_unit_reservation
  ON public.reservations (organization_id, unit_id)
  WHERE status IN ('CONFIRMED', 'PENDING');

CREATE INDEX IF NOT EXISTS idx_reservations_expiration_sweep
  ON public.reservations (organization_id, status, expires_at)
  WHERE status IN ('CONFIRMED', 'PENDING');
