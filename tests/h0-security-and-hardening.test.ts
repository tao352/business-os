import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  pool,
  migratorPool,
  withTenantContext,
  Client,
} from "../packages/database/src/index.js";
import {
  runPendingMigrations,
  verifyMigrationIntegrity,
  computeFileChecksum,
} from "../packages/database/src/migrator.js";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from "../packages/core/src/security/crypto-service.js";
import { assertActiveTenantMember } from "../packages/core/src/permissions/tenant-member-guard.js";
import {
  compileStructuredIntentToSql,
  UnsupportedQueryError,
} from "../packages/core/src/ai/query-safety-guard.js";
import {
  enqueueOutboxEvent,
  processPendingOutboxEvents,
} from "../packages/core/src/rules/outbox-service.js";
import {
  setFeatureFlag,
  PlatformAuthorizationError,
} from "../packages/core/src/ops/feature-flags-service.js";
import {
  consumeRateLimit,
  clearAllRateLimits,
} from "../packages/core/src/security/rate-limiter.js";
import { queryEntities } from "../packages/core/src/query/entity-query-service.js";
import { exportEntitiesToCsv } from "../packages/core/src/import-export/export-service.js";
import { executeImport } from "../packages/core/src/import-export/import-service.js";
import {
  createLead,
  assignLead,
} from "../packages/core/src/crm/lead-service.js";
import type { TenantContext } from "@business-os/types";

describe("H0 Foundation Audit & Hardening Regression Test Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let orgBProjectId: string;

  let contextAAdmin: TenantContext;
  let contextAMarketing: TenantContext;
  let contextASalesperson: TenantContext;
  let contextBAdmin: TenantContext;

  beforeAll(async () => {
    // 1. Set up two test organizations and users in the database
    const client = await pool.connect();
    try {
      const orgARes = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('H0 Org Alpha', 'h0-alpha-' || gen_random_uuid()) RETURNING id",
      );
      orgAId = orgARes.rows[0].id;

      const orgBRes = await client.query(
        "INSERT INTO organizations (name, slug) VALUES ('H0 Org Beta', 'h0-beta-' || gen_random_uuid()) RETURNING id",
      );
      orgBId = orgBRes.rows[0].id;

      const userARes = await client.query(
        "INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'User Alpha', 'hash_a') RETURNING id",
        [`h0-user-a-${crypto.randomUUID()}@example.com`],
      );
      userAId = userARes.rows[0].id;

      const userBRes = await client.query(
        "INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'User Beta', 'hash_b') RETURNING id",
        [`h0-user-b-${crypto.randomUUID()}@example.com`],
      );
      userBId = userBRes.rows[0].id;

      // Assign memberships
      await client.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'ADMIN', true)",
        [orgAId, userAId],
      );
      await client.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'ADMIN', true)",
        [orgBId, userBId],
      );

      // Create a valid project for Org B for relational testing
      const projBRes = await client.query(
        "INSERT INTO projects (organization_id, name, location) VALUES ($1, 'Beta Residence', 'Sheikh Zayed') RETURNING id",
        [orgBId],
      );
      orgBProjectId = projBRes.rows[0].id;
    } finally {
      client.release();
    }

    contextAAdmin = {
      userId: userAId,
      organizationId: orgAId,
      role: "ADMIN",
      permissions: ["*"],
    };

    contextAMarketing = {
      userId: userAId,
      organizationId: orgAId,
      role: "MARKETING_USER",
      permissions: ["leads:read", "campaigns:*"],
    };

    contextASalesperson = {
      userId: userAId,
      organizationId: orgAId,
      role: "SALESPERSON",
      permissions: ["leads:read", "leads:update"],
    };

    contextBAdmin = {
      userId: userBId,
      organizationId: orgBId,
      role: "ADMIN",
      permissions: ["*"],
    };
  });

  afterAll(async () => {
    await Promise.all([pool.end(), migratorPool.end()]);
  });

  describe("H0-16: Idempotent Migration Runner & Checksum Verification", () => {
    it("should be idempotent and detect zero new migrations when up to date", async () => {
      const rerun = await runPendingMigrations();
      expect(rerun.applied.length).toBe(0);
      expect(rerun.applied).toEqual([]);
    });

    it("should verify migration SHA-256 checksums without mismatch", async () => {
      const check = await verifyMigrationIntegrity();
      expect(check.valid).toBe(true);
      expect(check.mismatches).toEqual([]);
    });

    it("should compute identical SHA-256 checksums regardless of CRLF or LF line endings", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-check-"));
      const fileCrLf = path.join(tempDir, "crlf.sql");
      const fileLf = path.join(tempDir, "lf.sql");
      try {
        fs.writeFileSync(fileCrLf, "SELECT 1;\r\nSELECT 2;\r\n");
        fs.writeFileSync(fileLf, "SELECT 1;\nSELECT 2;\n");
        const hashCrLf = computeFileChecksum(fileCrLf);
        const hashLf = computeFileChecksum(fileLf);
        expect(hashCrLf).toBe(hashLf);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("H0-04: Composite Foreign Keys Database-Level Relational Isolation", () => {
    it("should reject inserting a unit in Org B that references a project in Org A", async () => {
      const client = await pool.connect();
      try {
        const projRes = await client.query(
          "INSERT INTO projects (organization_id, name, location) VALUES ($1, 'Alpha Tower', 'New Cairo') RETURNING id",
          [orgAId],
        );
        const orgAProjectId = projRes.rows[0].id;

        await expect(
          client.query(
            "INSERT INTO units (organization_id, project_id, unit_number, unit_type, gross_area, price, status) VALUES ($1, $2, 'U-Cross-01', 'APARTMENT', 150, 2500000, 'AVAILABLE')",
            [orgBId, orgAProjectId],
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
      } finally {
        client.release();
      }
    });

    it("should reject inserting a visit in Org B that references a lead in Org A", async () => {
      const client = await pool.connect();
      try {
        const leadRes = await client.query(
          "INSERT INTO leads (organization_id, full_name, phone, status) VALUES ($1, 'Lead Alpha', '+201000000001', 'NEW') RETURNING id",
          [orgAId],
        );
        const orgALeadId = leadRes.rows[0].id;

        await expect(
          client.query(
            "INSERT INTO visits (organization_id, lead_id, project_id, scheduled_by_user_id, scheduled_at, status) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'SCHEDULED')",
            [orgBId, orgALeadId, orgBProjectId, userBId],
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
      } finally {
        client.release();
      }
    });

    it("should reject inserting a deal in Org B that references a lead in Org A", async () => {
      const client = await pool.connect();
      try {
        const leadRes = await client.query(
          "INSERT INTO leads (organization_id, full_name, phone, status) VALUES ($1, 'Lead Deal Alpha', '+201000000002', 'NEW') RETURNING id",
          [orgAId],
        );
        const orgALeadId = leadRes.rows[0].id;

        await expect(
          client.query(
            "INSERT INTO deals (organization_id, lead_id, title, stage, value) VALUES ($1, $2, 'Cross Deal', 'PROPOSAL', 3000000)",
            [orgBId, orgALeadId],
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
      } finally {
        client.release();
      }
    });
  });

  describe("H0-05: Active Tenant Member Guard", () => {
    it("should allow active member within the same tenant", async () => {
      await expect(
        assertActiveTenantMember(contextAAdmin, userAId),
      ).resolves.toBeDefined();
    });

    it("should reject user belonging to another tenant", async () => {
      await expect(
        assertActiveTenantMember(contextAAdmin, userBId),
      ).rejects.toThrow(/is not an active member of organization/);
    });

    it("should reject assigning lead to a user outside tenant organization", async () => {
      const lead = await createLead(contextAAdmin, {
        fullName: "Test Lead For Assignment",
        phone: "+201011111111",
      });

      await expect(assignLead(contextAAdmin, lead.id, userBId)).rejects.toThrow(
        /is not an active member of organization/,
      );
    });
  });

  describe("H0-06: Authorization Enforcement & PII Redaction", () => {
    it("should redact PII for MARKETING_USER in entity query", async () => {
      await createLead(contextAAdmin, {
        fullName: "Confidential Client",
        phone: "+201099998888",
        email: "confidential@client.com",
      });

      const res = await queryEntities(contextAMarketing, "leads", {
        limit: 10,
        offset: 0,
      });

      expect(res.data.length).toBeGreaterThanOrEqual(1);
      const maskedLead = res.data.find(
        (l) => (l as any).contact_info_redacted === true,
      ) as any;
      expect(maskedLead).toBeDefined();
      expect(maskedLead.contact_info_redacted).toBe(true);
      expect(maskedLead.phone).toBeUndefined();
      expect(maskedLead.email).toBeUndefined();
      expect(maskedLead.full_name).toBeUndefined();
    });

    it("should reject export for roles without export permission", async () => {
      await expect(
        exportEntitiesToCsv(contextASalesperson, {
          entityType: "leads",
          format: "CSV",
        }),
      ).rejects.toThrow(
        /Role 'SALESPERSON' is not authorized to perform 'export'/,
      );
    });

    it("should reject import for roles without create permission", async () => {
      await expect(
        executeImport(
          contextAMarketing,
          "units",
          "unit_number,price\nU-99,1000000",
        ),
      ).rejects.toThrow(
        /Role 'MARKETING_USER' is not authorized to perform 'create'/,
      );
    });
  });

  describe("H0-07: Query Safety Whitelist Compiler", () => {
    it("should compile valid count query on leads to parameterized SQL", () => {
      const compiled = compileStructuredIntentToSql({
        entity: "leads",
        metric: "COUNT",
        filters: [{ field: "status", operator: "EQUALS", value: "NEW" }],
        limit: 10,
      });

      expect(compiled.sql).toContain(
        'SELECT count(*)::int as total FROM "leads"',
      );
      expect(compiled.sql).toContain('"status" = $1');
      expect(compiled.params).toContain("NEW");
    });

    it("should reject queries targeting non-whitelisted entities like users or audit_logs", () => {
      expect(() =>
        compileStructuredIntentToSql({
          entity: "users",
          metric: "LIST",
          filters: [],
          limit: 10,
        }),
      ).toThrow(UnsupportedQueryError);

      expect(() =>
        compileStructuredIntentToSql({
          entity: "audit_logs",
          metric: "LIST",
          filters: [],
          limit: 10,
        }),
      ).toThrow(UnsupportedQueryError);
    });

    it("should reject filters on unpermitted columns like password_hash", () => {
      expect(() =>
        compileStructuredIntentToSql({
          entity: "leads",
          metric: "LIST",
          filters: [{ field: "password_hash", operator: "EQUALS", value: "x" }],
          limit: 10,
        }),
      ).toThrow(UnsupportedQueryError);
    });
  });

  describe("H0-08 / H0-09: Transactional Outbox Pattern", () => {
    it("should enqueue and process an outbox event", async () => {
      const idempotencyKey = `outbox-test-${crypto.randomUUID()}`;

      const eventId = await withTenantContext(
        contextAAdmin.organizationId,
        async (tx) => {
          return await enqueueOutboxEvent(
            tx,
            contextAAdmin,
            "whatsapp.send_template",
            { recipientPhone: "+201012345678", templateName: "welcome_lead" },
            idempotencyKey,
          );
        },
      );

      expect(eventId).toBeDefined();

      // Process pending events with registered handler
      let dispatched = false;
      const result = await processPendingOutboxEvents(contextAAdmin, {
        "whatsapp.send_template": async () => {
          dispatched = true;
        },
      });

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(dispatched).toBe(true);
    });
  });

  describe("H0-11: Authenticated Encryption at Rest (AES-256-GCM)", () => {
    it("should encrypt and decrypt secrets with AES-256-GCM", () => {
      const rawToken = "EAAByz12345MetaSecretToken";
      const encrypted = encryptSecret(rawToken);

      expect(encrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(rawToken);
    });

    it("should reject tampered ciphertext with authentication error", () => {
      const rawToken = "MySecretKey";
      const encrypted = encryptSecret(rawToken);
      const parts = encrypted.split(":");
      parts[3] = parts[3] + "00";
      const tampered = parts.join(":");

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it("should safely mask secret strings", () => {
      expect(maskSecret("EAAB1234567890abcdef")).toBe("EAAB********cdef");
      expect(maskSecret("short")).toBe("********");
    });
  });

  describe("H0-12: Feature Flag Authorization Guard", () => {
    it("should reject non-admin users attempting to mutate feature flags", async () => {
      await expect(
        setFeatureFlag(
          {
            key: "beta_h0_feature",
            name: "H0 Feature",
            enabled_globally: true,
          },
          contextASalesperson,
        ),
      ).rejects.toThrow(PlatformAuthorizationError);
    });

    it("should allow platform admin context to configure feature flags", async () => {
      const flag = await setFeatureFlag(
        {
          key: `beta_h0_allowed_${crypto.randomBytes(4).toString("hex")}`,
          name: "Allowed Feature",
          enabled_globally: true,
        },
        { isPlatformAdmin: true, adminId: "super_admin_001" },
      );

      expect(flag.enabled_globally).toBe(true);
    });
  });

  describe("H0-18 / H0-20: Atomic Lua Rate Limiting", () => {
    it("should atomically enforce rate limit quota under concurrent load", async () => {
      await clearAllRateLimits();
      const testKey = `rl_concurrent_${crypto.randomUUID()}`;
      const config = { windowMs: 5000, maxRequests: 5, keyPrefix: "rl:test" };

      // Dispatch 10 concurrent requests
      const promises = Array.from({ length: 10 }).map(() =>
        consumeRateLimit(testKey, config),
      );
      const results = await Promise.all(promises);

      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(5);
      expect(blockedCount).toBe(5);
    });
  });

  describe("H0-21: Runtime Role Hardening & Least Privilege", () => {
    it("should ensure app_user has NOBYPASSRLS and no superuser privileges", async () => {
      const res = await pool.query(
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'",
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].rolsuper).toBe(false);
      expect(res.rows[0].rolbypassrls).toBe(false);
    });

    it("should prevent app_user from executing DDL operations on public schema", async () => {
      const appClient = new Client({
        connectionString:
          process.env.APP_DATABASE_URL ||
          "postgres://app_user:app_password@localhost:5432/business_os",
      });
      await appClient.connect();
      try {
        await expect(
          appClient.query(
            "CREATE TABLE public.test_forbidden_ddl (id serial primary key)",
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appClient.end();
      }
    });
  });
});
