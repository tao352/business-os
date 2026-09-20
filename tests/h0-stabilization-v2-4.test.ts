import { describe, it, expect, afterAll } from "vitest";
import crypto from "node:crypto";
import {
  pool,
  migratorPool,
  withTenantContext,
} from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  configureWhatsAppIntegration,
  sendWhatsAppMessage,
  processPendingWhatsAppOutbox,
  MockWhatsAppApiClient,
  WhatsAppApiError,
  enqueueWhatsAppOutbound,
} from "../packages/core/src/index.js";

async function createIsolatedTenant(prefix: string): Promise<{
  tenantContext: TenantContext;
  waPhoneId: string;
}> {
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await registerUser({
    email: `${prefix}.${suffix}@test.local`,
    password: "StrongPassword2026!",
    fullName: `Tenant ${prefix} Owner`,
  });
  const org = await createOrganization({
    userId: user.id,
    name: `Tenant ${prefix} ${suffix}`,
    slug: `tenant-${prefix.toLowerCase()}-${suffix}`,
  });
  const tenantContext: TenantContext = {
    userId: user.id,
    organizationId: org.id,
    role: "OWNER",
    correlationId: `test-${prefix}-${suffix}`,
  };
  const waPhoneId = `wa_phone_${prefix}_${suffix}`;
  await configureWhatsAppIntegration(tenantContext, {
    phoneNumberId: waPhoneId,
    wabaId: `waba_${suffix}`,
    accessToken: `token_${suffix}`,
    verifyToken: `verify_${suffix}`,
    displayPhoneNumber: "+201099990000",
  });
  return { tenantContext, waPhoneId };
}

describe("H0 Stabilization Patch v2.4 — Concurrency, Rollback Guarantees & Retry Classification", () => {
  afterAll(async () => {
    await Promise.all([pool.end(), migratorPool.end()]);
  });

  describe("1. Concurrent Idempotency Safe Insertion (No 25P02 Abort)", () => {
    it("handles concurrent requests with identical idempotencyKey without PostgreSQL transaction abortion", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("concurrent");
      const sharedIdempotencyKey = `idem_concurrent_${Date.now()}`;
      const recipient = "+201055550001";

      // Issue 2 concurrent send requests with the exact same idempotencyKey
      const [msgA, msgB] = await Promise.all([
        sendWhatsAppMessage(
          tenantContext,
          {
            phoneNumberId: waPhoneId,
            recipientPhone: recipient,
            text: "Parallel message call A",
          },
          undefined,
          { idempotencyKey: sharedIdempotencyKey },
        ),
        sendWhatsAppMessage(
          tenantContext,
          {
            phoneNumberId: waPhoneId,
            recipientPhone: recipient,
            text: "Parallel message call B",
          },
          undefined,
          { idempotencyKey: sharedIdempotencyKey },
        ),
      ]);

      // Both must successfully resolve and reference the exact same message record
      expect(msgA).toBeDefined();
      expect(msgB).toBeDefined();
      expect(msgA.id).toBe(msgB.id);
      expect(msgA.organizationId).toBe(tenantContext.organizationId);

      // Verify DB contains exactly 1 whatsapp_messages row and 1 outbox_events row
      const dbCheck = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRows = await tx.query(
            `SELECT id, status, idempotency_key FROM whatsapp_messages WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, sharedIdempotencyKey],
          );
          const outboxRows = await tx.query(
            `SELECT id, status, idempotency_key FROM outbox_events WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, sharedIdempotencyKey],
          );
          return {
            msgCount: msgRows.rows.length,
            outboxCount: outboxRows.rows.length,
            msg: msgRows.rows[0],
            outbox: outboxRows.rows[0],
          };
        },
      );

      expect(dbCheck.msgCount).toBe(1);
      expect(dbCheck.outboxCount).toBe(1);
      expect(dbCheck.msg.status).toBe("PENDING");
      expect(dbCheck.outbox.status).toBe("PENDING");
    });
  });

  describe("2. Transactional Outbox Rollback Guarantees", () => {
    it("rolls back both message and outbox event when transaction encounters downstream failure", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("rollback");
      const mockClient = new MockWhatsAppApiClient();
      const rollbackKey = `idem_rollback_${Date.now()}`;
      const recipient = "+201066660002";
      let simulatedErrorCaught = false;

      try {
        await withTenantContext(tenantContext.organizationId, async (tx) => {
          // 1. Enqueue WhatsApp message within transaction
          await enqueueWhatsAppOutbound(
            tx,
            tenantContext,
            {
              phoneNumberId: waPhoneId,
              recipientPhone: recipient,
              messageType: "text",
              text: "This message must never commit",
            },
            rollbackKey,
          );

          // 2. Simulate downstream business logic failure in the same transaction
          throw new Error(
            "Downstream business failure: forced transaction rollback",
          );
        });
      } catch (err: any) {
        if (err.message.includes("Downstream business failure")) {
          simulatedErrorCaught = true;
        } else {
          throw err;
        }
      }

      expect(simulatedErrorCaught).toBe(true);

      // 3. Verify zero state committed to the database
      const dbCheck = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRows = await tx.query(
            `SELECT id FROM whatsapp_messages WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, rollbackKey],
          );
          const outboxRows = await tx.query(
            `SELECT id FROM outbox_events WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, rollbackKey],
          );
          return {
            msgCount: msgRows.rows.length,
            outboxCount: outboxRows.rows.length,
          };
        },
      );

      expect(dbCheck.msgCount).toBe(0);
      expect(dbCheck.outboxCount).toBe(0);

      // 4. Zero provider calls occurred
      expect(mockClient.sentTexts.length).toBe(0);
    });
  });

  describe("3. WhatsApp Provider Retry Policy & Error Classification", () => {
    it("retries on 429 Rate Limit: resets message status to PENDING and preserves outbox event for retry", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("retry429");
      const mockClient = new MockWhatsAppApiClient();
      const recipient = "+201077770003";

      const msg = await sendWhatsAppMessage(tenantContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: recipient,
        text: "Message expecting 429 then recovery",
      });

      // 1. First worker run: simulate 429 Rate Limit from Meta
      mockClient.nextError = new WhatsAppApiError(
        "Meta Graph API rate limit hit (#429)",
        429,
        true, // retryable
        false,
      );

      const firstPass = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(firstPass.failed).toBe(1);

      // Inspect DB state after 429 failure:
      // Message must be reset to 'PENDING' so next worker iteration can claim it
      const afterFailCheck = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRes = await tx.query(
            `SELECT status FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          const outboxRes = await tx.query(
            `SELECT status, retry_count, max_retries, last_error FROM outbox_events WHERE payload->>'messageId' = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          return {
            msgStatus: msgRes.rows[0]?.status,
            outboxStatus: outboxRes.rows[0]?.status,
            retryCount: outboxRes.rows[0]?.retry_count,
            maxRetries: outboxRes.rows[0]?.max_retries,
          };
        },
      );

      expect(afterFailCheck.msgStatus).toBe("PENDING");
      expect(afterFailCheck.outboxStatus).toBe("FAILED");
      expect(afterFailCheck.retryCount).toBe(1);
      expect(afterFailCheck.retryCount).toBeLessThan(afterFailCheck.maxRetries);

      // 2. Second worker run: provider has recovered (no error set)
      const secondPass = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(secondPass.processed).toBe(1);

      const afterRecoveryCheck = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRes = await tx.query(
            `SELECT status, wamid FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          const outboxRes = await tx.query(
            `SELECT status FROM outbox_events WHERE payload->>'messageId' = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          return {
            msgStatus: msgRes.rows[0]?.status,
            wamid: msgRes.rows[0]?.wamid,
            outboxStatus: outboxRes.rows[0]?.status,
          };
        },
      );

      expect(afterRecoveryCheck.msgStatus).toBe("SENT");
      expect(afterRecoveryCheck.wamid).toBeDefined();
      expect(afterRecoveryCheck.wamid).toMatch(/^wamid\./);
      expect(afterRecoveryCheck.outboxStatus).toBe("COMPLETED");
    });

    it("retries on 503 Service Unavailable: resets message status to PENDING and preserves outbox event", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("retry503");
      const mockClient = new MockWhatsAppApiClient();
      const recipient = "+201088880004";

      const msg = await sendWhatsAppMessage(tenantContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: recipient,
        text: "Message expecting 503 then recovery",
      });

      mockClient.nextError = new WhatsAppApiError(
        "Meta Internal Server Error (503 Service Unavailable)",
        503,
        true, // retryable
        false,
      );

      const res = await processPendingWhatsAppOutbox(tenantContext, mockClient);
      expect(res.failed).toBe(1);

      const check = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRes = await tx.query(
            `SELECT status FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          const outboxRes = await tx.query(
            `SELECT status, retry_count, max_retries FROM outbox_events WHERE payload->>'messageId' = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          return {
            msgStatus: msgRes.rows[0]?.status,
            outboxStatus: outboxRes.rows[0]?.status,
            retryCount: outboxRes.rows[0]?.retry_count,
            maxRetries: outboxRes.rows[0]?.max_retries,
          };
        },
      );

      expect(check.msgStatus).toBe("PENDING");
      expect(check.outboxStatus).toBe("FAILED");
      expect(check.retryCount).toBeLessThan(check.maxRetries);
    });

    it("terminates immediately on 400 Bad Request: marks message FAILED and exhausts outbox retries", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("term400");
      const mockClient = new MockWhatsAppApiClient();
      const recipient = "+201099990005";

      const msg = await sendWhatsAppMessage(tenantContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: recipient,
        text: "Message expecting 400 terminal failure",
      });

      mockClient.nextError = new WhatsAppApiError(
        "Template parameter count mismatch (400 Bad Request)",
        400,
        false, // non-retryable (terminal)
        false,
      );

      const pass1 = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(pass1.failed).toBe(1);

      const check = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRes = await tx.query(
            `SELECT status FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          const outboxRes = await tx.query(
            `SELECT status, retry_count, max_retries, last_error FROM outbox_events WHERE payload->>'messageId' = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          return {
            msgStatus: msgRes.rows[0]?.status,
            outboxStatus: outboxRes.rows[0]?.status,
            retryCount: outboxRes.rows[0]?.retry_count,
            maxRetries: outboxRes.rows[0]?.max_retries,
            lastError: outboxRes.rows[0]?.last_error,
          };
        },
      );

      expect(check.msgStatus).toBe("FAILED");
      expect(check.outboxStatus).toBe("FAILED");
      expect(check.retryCount).toBe(check.maxRetries);
      expect(check.lastError).toContain(
        "Terminal WhatsApp provider failure (400)",
      );

      // Second worker run: outbox event must NOT be retried
      const pass2 = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(pass2.processed).toBe(0);
      expect(pass2.failed).toBe(0);
    });

    it("transitions to UNKNOWN on ambiguous network timeout and suppresses blind retries", async () => {
      const { tenantContext, waPhoneId } =
        await createIsolatedTenant("timeout");
      const mockClient = new MockWhatsAppApiClient();
      const recipient = "+201033330006";

      const msg = await sendWhatsAppMessage(tenantContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: recipient,
        text: "Message expecting network timeout",
      });

      mockClient.nextError = new WhatsAppApiError(
        "Network timeout waiting for Meta Graph API ACK",
        0,
        false,
        true, // isAmbiguous
      );

      const pass = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(pass.failed).toBe(1);

      const check = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const msgRes = await tx.query(
            `SELECT status FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          const outboxRes = await tx.query(
            `SELECT status, retry_count, max_retries, last_error FROM outbox_events WHERE payload->>'messageId' = $1 AND organization_id = $2`,
            [msg.id, tenantContext.organizationId],
          );
          return {
            msgStatus: msgRes.rows[0]?.status,
            outboxStatus: outboxRes.rows[0]?.status,
            retryCount: outboxRes.rows[0]?.retry_count,
            maxRetries: outboxRes.rows[0]?.max_retries,
            lastError: outboxRes.rows[0]?.last_error,
          };
        },
      );

      // Must be UNKNOWN (never left in SENDING or blindly retried)
      expect(check.msgStatus).toBe("UNKNOWN");
      expect(check.outboxStatus).toBe("FAILED");
      expect(check.retryCount).toBe(check.maxRetries);
      expect(check.lastError).toContain("Ambiguous network dispatch failure");
    });
  });

  describe("4. Administrative Migrator Pool Separation", () => {
    it("ensures migratorPool connects and can query schema_migrations independently", async () => {
      expect(migratorPool).toBeDefined();
      expect(migratorPool).not.toBe(pool);

      const client = await migratorPool.connect();
      try {
        const res = await client.query(
          "SELECT count(*)::int as count FROM schema_migrations",
        );
        expect(res.rows[0].count).toBeGreaterThanOrEqual(17);
      } finally {
        client.release();
      }
    });
  });
});
