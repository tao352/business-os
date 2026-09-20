-- Migration 0014: H0 Database Runtime Role Hardening & Least Privilege
-- Enforces strict separation between migrator/admin role (DDL) and application runtime role (DML only, NOBYPASSRLS)

-- 1. Ensure app_user exists and explicitly disallow bypassing RLS or superuser/DDL capabilities
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    ALTER ROLE app_user NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Revoke schema modification (CREATE) privileges on public schema from app_user
REVOKE CREATE ON SCHEMA public FROM app_user;

-- 3. Revoke all privileges on all tables in public schema, then grant only strict DML (SELECT, INSERT, UPDATE, DELETE)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- 4. Revoke all privileges on sequences, then grant USAGE and SELECT only
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 5. Set default privileges for future objects created in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
