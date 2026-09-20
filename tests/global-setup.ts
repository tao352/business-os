import {
  runPendingMigrations,
  verifyMigrationIntegrity,
} from "../packages/database/src/migrator.js";
import { pool, migratorPool } from "../packages/database/src/client.js";

/**
 * Vitest Global Setup: Executes ONCE in the main process before any test runner threads are spawned.
 * Ensures all database extensions, tables, composite constraints, and outbox tables exist,
 * completely eliminating parallel migration race conditions on fresh PostgreSQL instances.
 */
export async function setup(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    "\n[Global Setup] Applying all database migrations sequentially...",
  );
  const result = await runPendingMigrations();
  // eslint-disable-next-line no-console
  console.log(
    `[Global Setup] Migrations complete: ${result.applied.length} applied, ${result.skipped.length} already current.`,
  );

  const integrity = await verifyMigrationIntegrity();
  if (!integrity.valid) {
    throw new Error(
      `[Global Setup] FATAL: Database migration integrity check failed: ${integrity.mismatches.join("; ")}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    "[Global Setup] Database schema verified and ready for concurrent testing.\n",
  );
}

export async function teardown(): Promise<void> {
  await Promise.all([pool.end(), migratorPool.end()]);
}
