import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { migratorPool } from "./client.js";
import { logger } from "@business-os/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MigrationError extends Error {
  constructor(message: string) {
    super(`Migration Error: ${message}`);
    this.name = "MigrationError";
  }
}

export interface AppliedMigration {
  id: number;
  migration_name: string;
  checksum: string;
  applied_at: Date;
}

export function computeFileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content.trim()).digest("hex");
}

/**
 * Runs all unapplied database migrations sequentially within transactions.
 * Enforces checksum integrity on previously applied migrations.
 */
export async function runPendingMigrations(
  customClient?: PoolClient,
): Promise<{ applied: string[]; skipped: string[] }> {
  const client = customClient || (await migratorPool.connect());
  const shouldRelease = !customClient;

  try {
    // 1. Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied migrations
    const appliedRes = await client.query<AppliedMigration>(
      "SELECT migration_name, checksum FROM schema_migrations ORDER BY id ASC",
    );
    const appliedMap = new Map(
      appliedRes.rows.map((r) => [r.migration_name, r.checksum]),
    );

    // 3. Locate migrations folder
    const migrationsDir = path.resolve(__dirname, "../migrations");
    if (!fs.existsSync(migrationsDir)) {
      throw new MigrationError(
        `Migrations directory not found at: ${migrationsDir}`,
      );
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const currentChecksum = computeFileChecksum(filePath);
      const existingChecksum = appliedMap.get(file);

      if (existingChecksum) {
        // Verify checksum has not been tampered with
        if (existingChecksum !== currentChecksum) {
          throw new MigrationError(
            `Migration checksum mismatch for '${file}'. Expected ${existingChecksum}, found ${currentChecksum}. Modifying applied migrations is strictly forbidden.`,
          );
        }
        skipped.push(file);
        continue;
      }

      // Apply new migration in transaction
      logger.info({ migration: file }, "Applying database migration");
      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)",
          [file, currentChecksum],
        );
        await client.query("COMMIT");
        applied.push(file);
        logger.info({ migration: file }, "Migration applied successfully");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error(
          {
            migration: file,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to apply database migration",
        );
        throw new MigrationError(
          `Failed to apply migration '${file}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { applied, skipped };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

/**
 * Validates that all applied migrations in schema_migrations match current disk files.
 */
export async function verifyMigrationIntegrity(
  customClient?: PoolClient,
): Promise<{ valid: boolean; mismatches: string[] }> {
  const client = customClient || (await migratorPool.connect());
  const shouldRelease = !customClient;

  try {
    const res = await client.query<AppliedMigration>(
      "SELECT migration_name, checksum FROM schema_migrations ORDER BY id ASC",
    );
    const migrationsDir = path.resolve(__dirname, "../migrations");
    const mismatches: string[] = [];

    for (const row of res.rows) {
      const filePath = path.join(migrationsDir, row.migration_name);
      if (!fs.existsSync(filePath)) {
        mismatches.push(`Missing file: ${row.migration_name}`);
        continue;
      }
      const actualChecksum = computeFileChecksum(filePath);
      if (actualChecksum !== row.checksum) {
        mismatches.push(
          `Checksum mismatch for ${row.migration_name}: expected ${row.checksum}, found ${actualChecksum}`,
        );
      }
    }

    return { valid: mismatches.length === 0, mismatches };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}
