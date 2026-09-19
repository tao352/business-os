import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pool, withTenantContext } from '../packages/database/src/index.js';

describe('Live PostgreSQL Engine & RLS Verification', () => {
  beforeAll(async () => {
    // Apply migration files to ensure database is in expected state
    const migration1 = fs.readFileSync(
      path.resolve(__dirname, '../packages/database/migrations/0001_initial_extensions.sql'),
      'utf-8'
    );
    const migration2 = fs.readFileSync(
      path.resolve(__dirname, '../packages/database/migrations/0002_core_schema.sql'),
      'utf-8'
    );

    const client = await pool.connect();
    try {
      await client.query(migration1);
      await client.query(migration2);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verifies that required extensions are active in PostgreSQL', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto', 'vector')"
      );
      const activeExtensions = res.rows.map((r) => r.extname);
      expect(activeExtensions).toContain('uuid-ossp');
      expect(activeExtensions).toContain('pgcrypto');
      expect(activeExtensions).toContain('vector');
    } finally {
      client.release();
    }
  });

  it('mathematically enforces tenant isolation between Org Alpha and Org Beta', async () => {
    const client = await pool.connect();
    let orgAlphaId: string;
    let orgBetaId: string;

    try {
      // Create two distinct tenant organizations
      const alphaRes = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('Real Estate Alpha', 'alpha-' || gen_random_uuid()) RETURNING id"
      );
      orgAlphaId = alphaRes.rows[0].id;

      const betaRes = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('Real Estate Beta', 'beta-' || gen_random_uuid()) RETURNING id"
      );
      orgBetaId = betaRes.rows[0].id;
    } finally {
      client.release();
    }

    // Insert Lead in Org Alpha
    const leadAlphaId = await withTenantContext(orgAlphaId, async (tx) => {
      const res = await tx.query(
        `INSERT INTO leads (organization_id, full_name, phone, status, custom_data)
         VALUES ($1, 'Buyer Alpha', '+201000000001', 'NEW', '{"budget": 2000000}')
         RETURNING id`,
        [orgAlphaId]
      );
      return res.rows[0].id;
    });

    // Insert Lead in Org Beta
    const leadBetaId = await withTenantContext(orgBetaId, async (tx) => {
      const res = await tx.query(
        `INSERT INTO leads (organization_id, full_name, phone, status, custom_data)
         VALUES ($1, 'Buyer Beta', '+201000000002', 'NEW', '{"budget": 5000000}')
         RETURNING id`,
        [orgBetaId]
      );
      return res.rows[0].id;
    });

    // 1. Org Alpha query MUST see Lead Alpha but ZERO rows for Lead Beta
    await withTenantContext(orgAlphaId, async (tx) => {
      const allLeads = await tx.query('SELECT id, full_name FROM leads');
      const leadIds = allLeads.rows.map((r) => r.id);

      expect(leadIds).toContain(leadAlphaId);
      expect(leadIds).not.toContain(leadBetaId);

      // Direct ID lookup on Org Beta lead MUST return empty
      const leakAttempt = await tx.query('SELECT * FROM leads WHERE id = $1', [leadBetaId]);
      expect(leakAttempt.rows.length).toBe(0);

      // Malicious blind UPDATE targeting Org Beta lead MUST affect 0 rows
      const updateAttempt = await tx.query(
        "UPDATE leads SET full_name = 'Hacked' WHERE id = $1",
        [leadBetaId]
      );
      expect(updateAttempt.rowCount).toBe(0);
    });

    // 2. Org Beta query MUST see Lead Beta but ZERO rows for Lead Alpha
    await withTenantContext(orgBetaId, async (tx) => {
      const allLeads = await tx.query('SELECT id, full_name FROM leads');
      const leadIds = allLeads.rows.map((r) => r.id);

      expect(leadIds).toContain(leadBetaId);
      expect(leadIds).not.toContain(leadAlphaId);

      const leakAttempt = await tx.query('SELECT * FROM leads WHERE id = $1', [leadAlphaId]);
      expect(leakAttempt.rows.length).toBe(0);
    });
  });

  it('prohibits UPDATE and DELETE on audit_logs to guarantee tamper resistance', async () => {
    let testOrgId: string;
    const client = await pool.connect();
    try {
      const res = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('Audit Test Org', 'audit-' || gen_random_uuid()) RETURNING id"
      );
      testOrgId = res.rows[0].id;
    } finally {
      client.release();
    }

    const auditId = await withTenantContext(testOrgId, async (tx) => {
      const res = await tx.query(
        `INSERT INTO audit_logs (organization_id, actor_id, actor_type, action, entity_type, entity_id)
         VALUES ($1, 'user-123', 'USER', 'CREATE', 'lead', 'lead-123')
         RETURNING id`,
        [testOrgId]
      );
      return res.rows[0].id;
    });

    // Attempting to UPDATE the audit record MUST fail
    await expect(
      withTenantContext(testOrgId, async (tx) => {
        await tx.query("UPDATE audit_logs SET action = 'ALTERED' WHERE id = $1", [auditId]);
      })
    ).rejects.toThrow(/Audit logs are immutable/);

    // Attempting to DELETE the audit record MUST fail
    await expect(
      withTenantContext(testOrgId, async (tx) => {
        await tx.query('DELETE FROM audit_logs WHERE id = $1', [auditId]);
      })
    ).rejects.toThrow(/Audit logs are immutable/);
  });
});
