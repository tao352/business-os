-------------------------------------------------------------------
-- Migration 0018: Phase 21 auth bootstrap + SECURITY DEFINER hygiene
-------------------------------------------------------------------

-- Dedicated owner for the ONLY pre-tenant membership discovery path.
-- It cannot log in. BYPASSRLS exists only so the owned function can read
-- FORCE-RLS organization_memberships before a tenant context is known.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'business_os_auth_router_owner'
  ) THEN
    CREATE ROLE business_os_auth_router_owner
      WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE business_os_auth_router_owner
      NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM business_os_auth_router_owner;
GRANT USAGE ON SCHEMA public TO business_os_auth_router_owner;

REVOKE ALL ON public.organization_memberships FROM business_os_auth_router_owner;
REVOKE ALL ON public.organizations FROM business_os_auth_router_owner;

GRANT SELECT ON public.organization_memberships TO business_os_auth_router_owner;
GRANT SELECT ON public.organizations TO business_os_auth_router_owner;

-- Returns the minimum bootstrap metadata required by login/session/org-switch UI.
-- No email, password hash, user profile, settings, or other tenant data.
CREATE OR REPLACE FUNCTION public.auth_list_active_memberships(p_user_id UUID)
RETURNS TABLE (
  organization_id UUID,
  organization_name VARCHAR(150),
  organization_slug VARCHAR(50),
  role VARCHAR(50)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    m.organization_id,
    o.name AS organization_name,
    o.slug AS organization_slug,
    m.role
  FROM public.organization_memberships AS m
  JOIN public.organizations AS o
    ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.is_active = true
  ORDER BY o.created_at ASC;
$$;

ALTER FUNCTION public.auth_list_active_memberships(UUID)
  OWNER TO business_os_auth_router_owner;

REVOKE ALL
  ON FUNCTION public.auth_list_active_memberships(UUID)
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.auth_list_active_memberships(UUID)
  TO app_user;

-- Harden the two H0 SECURITY DEFINER routers without rewriting old migrations.
-- pg_temp is explicitly last; public references in the function bodies are
-- already schema-qualified.
ALTER FUNCTION public.resolve_meta_tenant(VARCHAR)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.resolve_whatsapp_tenant(VARCHAR)
  SET search_path = pg_catalog, public, pg_temp;
