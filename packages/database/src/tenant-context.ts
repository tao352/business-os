import type { PoolClient } from "pg";
import { pool } from "./client.js";
import { logger } from "@business-os/logger";

/**
 * Executes a database operation within an explicit tenant isolation context.
 * Sets the PostgreSQL local session variable `app.current_tenant_id` for the duration
 * of the transaction, ensuring that Row Level Security (RLS) policies are mathematically enforced.
 *
 * @param organizationId - UUID of the tenant organization
 * @param operation - Async callback receiving the tenant-scoped client
 * @returns Result of the callback operation
 */
export async function withTenantContext<T>(
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new Error(
      "withTenantContext requires a valid non-empty organizationId",
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Switch to application user role so superuser RLS bypass does not apply
    await client.query("SET LOCAL ROLE app_user");

    // Set local configuration parameter for this transaction only using PostgreSQL's set_config
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      organizationId,
    ]);

    const result = await operation(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error(
      { error, organizationId },
      "Transaction failed inside withTenantContext, rolled back",
    );
    throw error;
  } finally {
    client.release();
  }
}
