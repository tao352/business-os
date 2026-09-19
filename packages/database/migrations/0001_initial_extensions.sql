-- ==============================================================================
-- MIGRATION 0001: INITIAL EXTENSIONS
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Setup custom configuration parameter for tenant context
-- This allows SET LOCAL app.current_tenant_id to be stored during transactions
DO $$
BEGIN
  PERFORM set_config('app.current_tenant_id', '', false);
END $$;
