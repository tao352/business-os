import type { PoolClient } from "pg";
import { pool } from "../packages/database/src/client.js";
import { logger } from "@business-os/logger";

export interface ProvisionRolesOptions {
  username?: string;
  password?: string;
  nodeEnv?: string;
}

export class RoleProvisioningError extends Error {
  constructor(message: string) {
    super(`Role Provisioning Error: ${message}`);
    this.name = "RoleProvisioningError";
  }
}

/**
 * Provisions or updates the least-privilege runtime PostgreSQL role (app_user).
 * Runs strictly as a deployment/bootstrap step using the admin/migrator connection.
 */
export async function provisionRuntimeDbRoles(
  customClient?: PoolClient,
  options?: ProvisionRolesOptions,
): Promise<{ username: string; provisioned: boolean }> {
  const username = "app_user";
  if (options?.username && options.username !== "app_user") {
    throw new RoleProvisioningError(
      `Custom runtime role username '${options.username}' is not supported. The Business OS runtime role is fixed to 'app_user'.`,
    );
  }
  const password =
    options?.password !== undefined
      ? options.password
      : process.env.APP_DB_PASSWORD;
  const nodeEnv = options?.nodeEnv || process.env.NODE_ENV || "development";

  // Production Fail-Closed Validations
  if (nodeEnv === "production") {
    if (!password) {
      throw new RoleProvisioningError(
        "APP_DB_PASSWORD is strictly required in production environment.",
      );
    }
    if (password.length < 16) {
      throw new RoleProvisioningError(
        "APP_DB_PASSWORD must be at least 16 characters in production.",
      );
    }
    if (
      password === "app_password" ||
      password.toLowerCase().includes("password") ||
      password.toLowerCase().includes("secret")
    ) {
      throw new RoleProvisioningError(
        "APP_DB_PASSWORD cannot use default or trivial passwords in production.",
      );
    }
  }

  // Validate username to prevent SQL injection in DDL identifier
  if (!/^[a-zA-Z0-9_]{1,63}$/.test(username)) {
    throw new RoleProvisioningError(
      `Invalid PostgreSQL role username: '${username}'`,
    );
  }

  const client = customClient || (await pool.connect());
  const shouldRelease = !customClient;

  try {
    // 1. Ensure role exists
    const roleExists = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [username],
    );

    if (roleExists.rows.length === 0) {
      await client.query(`CREATE ROLE "${username}" WITH LOGIN`);
    }

    // 2. Set password if provided
    if (password) {
      // Use client.query with escaped literal for password
      const escapedPassword = password.replace(/'/g, "''");
      await client.query(
        `ALTER ROLE "${username}" WITH PASSWORD '${escapedPassword}'`,
      );
    }

    // 3. Enforce strict least-privilege security flags
    await client.query(
      `ALTER ROLE "${username}" NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );

    // 4. Ensure DDL restrictions and DML-only grants on public schema
    await client.query(`REVOKE CREATE ON SCHEMA public FROM "${username}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${username}"`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${username}"`,
    );

    logger.info(
      { username, role: "runtime_least_privilege" },
      "Successfully provisioned runtime database role",
    );

    return { username, provisioned: true };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

// CLI entry point
if (process.argv[1]?.includes("provision-db-roles")) {
  provisionRuntimeDbRoles()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `[Provisioning] Role '${result.username}' configured successfully.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[Provisioning] FAILED: ${err.message}`);
      process.exit(1);
    });
}
