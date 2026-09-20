import {
  runPendingMigrations,
  verifyMigrationIntegrity,
  migratorPool,
  pool,
} from "@business-os/database";

async function main() {
  const result = await runPendingMigrations();
  const integrity = await verifyMigrationIntegrity();

  if (!integrity.valid) {
    throw new Error(
      `Migration integrity failed: ${integrity.mismatches.join("; ")}`,
    );
  }

  console.log(
    `[Migrations] ${result.applied.length} applied, ${result.skipped.length} already current.`,
  );
}

main()
  .then(async () => {
    await pool.end();
    await migratorPool.end();
  })
  .catch(async (error) => {
    console.error(
      "[Migrations] FAILED:",
      error instanceof Error ? error.message : String(error),
    );

    try {
      await pool.end();
      await migratorPool.end();
    } catch {
      // ignore teardown failure
    }

    process.exit(1);
  });
