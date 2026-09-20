import type { Pool, PoolClient } from "pg";
import { pool } from "./client.js";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export interface RuntimeDatabaseRoleInfo {
  currentUser: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
}

export async function inspectRuntimeDatabaseRole(
  database: Queryable = pool,
): Promise<RuntimeDatabaseRoleInfo> {
  const result = await database.query<{
    current_user: string;
    is_superuser: boolean;
    bypass_rls: boolean;
    can_create_db: boolean;
    can_create_role: boolean;
  }>(`
    SELECT
      current_user AS current_user,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypass_rls,
      role.rolcreatedb AS can_create_db,
      role.rolcreaterole AS can_create_role
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = current_user
  `);

  if (result.rows.length !== 1) {
    throw new Error(
      "FATAL DATABASE SECURITY ERROR: unable to resolve runtime PostgreSQL role.",
    );
  }

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      "FATAL DATABASE SECURITY ERROR: unable to resolve runtime PostgreSQL role.",
    );
  }

  return {
    currentUser: row.current_user,
    isSuperuser: row.is_superuser,
    bypassRls: row.bypass_rls,
    canCreateDb: row.can_create_db,
    canCreateRole: row.can_create_role,
  };
}

export async function assertLeastPrivilegeRuntimeDatabaseRole(
  options: {
    database?: Queryable;
    expectedRole?: string;
  } = {},
): Promise<RuntimeDatabaseRoleInfo> {
  const expectedRole =
    options.expectedRole || process.env.EXPECTED_DATABASE_ROLE || "app_user";

  const info = await inspectRuntimeDatabaseRole(options.database || pool);

  if (info.currentUser !== expectedRole) {
    throw new Error(
      `FATAL DATABASE SECURITY ERROR: web runtime connected as '${info.currentUser}', expected '${expectedRole}'.`,
    );
  }

  if (
    info.isSuperuser ||
    info.bypassRls ||
    info.canCreateDb ||
    info.canCreateRole
  ) {
    throw new Error(
      "FATAL DATABASE SECURITY ERROR: web runtime database role is privileged. Startup aborted.",
    );
  }

  return info;
}
