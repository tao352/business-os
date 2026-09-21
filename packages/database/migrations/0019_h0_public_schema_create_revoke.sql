-- ==============================================================================
-- MIGRATION 0019: H0 RUNTIME HARDENING — STRICT LEAST-PRIVILEGE PUBLIC SCHEMA REVOKE
-- ==============================================================================

-- Restrict arbitrary DDL execution in the public schema to administrative roles only
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM app_user;
