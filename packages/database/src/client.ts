import pg from 'pg';
import { logger } from '@business-os/logger';

const { Pool } = pg;

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgrespassword@localhost:5432/business_os';

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DATABASE_MAX_CONNECTIONS || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}
