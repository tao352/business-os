import pg from "pg";
import { logger } from "@business-os/logger";

const { Pool, Client } = pg;
export { Pool, Client };

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgrespassword@localhost:5432/business_os";

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DATABASE_MAX_CONNECTIONS || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected error on idle PostgreSQL client");
});

let _migratorPoolInstance: pg.Pool | null = null;

export function getMigratorPool(): pg.Pool {
  if (!_migratorPoolInstance) {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.MIGRATOR_DATABASE_URL
    ) {
      throw new Error(
        "MIGRATOR_DATABASE_URL is strictly required for administrative database operations in production environment.",
      );
    }
    const migratorDatabaseUrl =
      process.env.MIGRATOR_DATABASE_URL ||
      process.env.TEST_ADMIN_DATABASE_URL ||
      databaseUrl;
    _migratorPoolInstance = new Pool({
      connectionString: migratorDatabaseUrl,
      max: Number(process.env.MIGRATOR_DATABASE_MAX_CONNECTIONS || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _migratorPoolInstance.on("error", (err) => {
      logger.error(
        { err },
        "Unexpected error on idle migrator PostgreSQL client",
      );
    });
  }
  return _migratorPoolInstance;
}

export const migratorPool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    if (prop === "end") {
      if (!_migratorPoolInstance) {
        return async () => {};
      }
      return _migratorPoolInstance.end.bind(_migratorPoolInstance);
    }
    const p = getMigratorPool();
    const val = Reflect.get(p, prop, receiver);
    if (typeof val === "function") {
      return val.bind(p);
    }
    return val;
  },
});

export function resetMigratorPoolForTesting(): void {
  _migratorPoolInstance = null;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return false;
  }
}
