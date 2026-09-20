import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  configureMetaIntegration,
  configureWhatsAppIntegration,
  sendWhatsAppMessage,
  processPendingWhatsAppOutbox,
  MockWhatsAppApiClient,
} from "../packages/core/src/index.js";
import {
  enqueueOutboxEvent,
  processPendingOutboxEvents,
} from "../packages/core/src/rules/outbox-service.js";
import {
  provisionRuntimeDbRoles,
  RoleProvisioningError,
} from "../scripts/provision-db-roles.js";

describe("H0 Stabilization Patch v2.2 — Routing Uniqueness & Durable Outbox", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let tenantAContext: TenantContext;
  let tenantBContext: TenantContext;
  let mockClient: MockWhatsAppApiClient;

  beforeAll(async () => {
    mockClient = new MockWhatsAppApiClient();

    // Tenant A setup
    const userA = await registerUser({
      email: `owner.h0v22.a.${uniqueSuffix}@test.local`,
      password: "StrongPassword2026!",
      fullName: "Tenant A Owner",
    });
    const orgA = await createOrganization({
      userId: userA.id,
      name: `Tenant A ${uniqueSuffix}`,
      slug: `tenant-a-${uniqueSuffix}`,
    });
    tenantAContext = {
      userId: userA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `test-v22-a-${uniqueSuffix}`,
    };

    // Tenant B setup
    const userB = await registerUser({
      email: `owner.h0v22.b.${uniqueSuffix}@test.local`,
      password: "StrongPassword2026!",
      fullName: "Tenant B Owner",
    });
    const orgB = await createOrganization({
      userId: userB.id,
      name: `Tenant B ${uniqueSuffix}`,
      slug: `tenant-b-${uniqueSuffix}`,
    });
    tenantBContext = {
      userId: userB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `test-v22-b-${uniqueSuffix}`,
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("1. Platform-Wide Active Routing Uniqueness (P0 Cross-Tenant Routing Protection)", () => {
    const sharedPageId = `meta_page_${uniqueSuffix}`;
    const sharedPhoneId = `wa_phone_${uniqueSuffix}`;

    it("prevents Tenant B from claiming an active Meta page_id owned by Tenant A", async () => {
      // Tenant A configures active Meta integration
      await configureMetaIntegration(tenantAContext, {
        pageId: sharedPageId,
        pageName: "Tenant A Page",
        pageAccessToken: "token_a",
        appSecret: "secret_a",
        verifyToken: "verify_a",
      });

      // Tenant B attempts to configure the same active page_id
      await expect(
        configureMetaIntegration(tenantBContext, {
          pageId: sharedPageId,
          pageName: "Tenant B Hijack Attempt",
          pageAccessToken: "token_b",
          appSecret: "secret_b",
          verifyToken: "verify_b",
        }),
      ).rejects.toThrow(/idx_meta_integrations_active_page_id/);
    });

    it("allows Tenant B to claim Meta page_id after Tenant A deactivates it", async () => {
      // Tenant A deactivates the integration
      await withTenantContext(tenantAContext.organizationId, async (tx) => {
        await tx.query(
          `UPDATE meta_integrations SET is_active = false WHERE page_id = $1`,
          [sharedPageId],
        );
      });

      // Tenant B can now successfully activate it
      const integrationB = await configureMetaIntegration(tenantBContext, {
        pageId: sharedPageId,
        pageName: "Tenant B Legitimate Claim",
        pageAccessToken: "token_b",
        appSecret: "secret_b",
        verifyToken: "verify_b",
      });

      expect(integrationB.id).toBeDefined();
      expect(integrationB.isActive).toBe(true);
    });

    it("prevents Tenant B from claiming an active WhatsApp phone_number_id owned by Tenant A", async () => {
      // Tenant A configures active WhatsApp integration
      await configureWhatsAppIntegration(tenantAContext, {
        wabaId: `waba_a_${uniqueSuffix}`,
        phoneNumberId: sharedPhoneId,
        displayPhoneNumber: "+201011112222",
        accessToken: "wa_token_a",
        appSecret: "wa_secret_a",
        verifyToken: "wa_verify_a",
      });

      // Tenant B attempts to configure the same active phone_number_id
      await expect(
        configureWhatsAppIntegration(tenantBContext, {
          wabaId: `waba_b_${uniqueSuffix}`,
          phoneNumberId: sharedPhoneId,
          displayPhoneNumber: "+201033334444",
          accessToken: "wa_token_b",
          appSecret: "wa_secret_b",
          verifyToken: "wa_verify_b",
        }),
      ).rejects.toThrow(/idx_whatsapp_integrations_active_phone_id/);
    });
  });

  describe("2. Enqueue-Only WhatsApp Outbox Architecture (P0 Duplicate Elimination)", () => {
    const waPhoneId = `wa_phone_durable_${uniqueSuffix}`;
    let messageId: string;

    beforeAll(async () => {
      await configureWhatsAppIntegration(tenantAContext, {
        wabaId: `waba_durable_${uniqueSuffix}`,
        phoneNumberId: waPhoneId,
        displayPhoneNumber: "+201055554444",
        accessToken: "wa_token_durable",
        appSecret: "wa_secret_durable",
        verifyToken: "wa_verify_durable",
      });
    });

    it("sendWhatsAppMessage writes PENDING message and outbox event with zero provider HTTP calls", async () => {
      let providerCalled = false;
      const testClient = new MockWhatsAppApiClient();
      testClient.sendText = async () => {
        providerCalled = true;
        return { wamid: "wamid.should_not_happen" };
      };

      const record = await sendWhatsAppMessage(
        tenantAContext,
        {
          phoneNumberId: waPhoneId,
          recipientPhone: "+201099998888",
          text: "Durable Outbox Test Message",
        },
        testClient,
      );

      messageId = record.id;
      expect(record.status).toBe("PENDING");
      expect(record.wamid).toBeNull();
      expect(providerCalled).toBe(false);

      // Verify message in DB is PENDING
      const dbMsg = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, wamid FROM whatsapp_messages WHERE id = $1`,
            [messageId],
          );
          return r.rows[0];
        },
      );
      expect(dbMsg.status).toBe("PENDING");
      expect(dbMsg.wamid).toBeNull();

      // Verify outbox event in DB is PENDING
      const dbOutbox = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, event_type FROM outbox_events WHERE organization_id = $1 AND payload->>'messageId' = $2`,
            [tenantAContext.organizationId, messageId],
          );
          return r.rows[0];
        },
      );
      expect(dbOutbox.status).toBe("PENDING");
      expect(dbOutbox.event_type).toBe("whatsapp.send_outbound");
    });

    it("processPendingWhatsAppOutbox dispatches via provider and marks message SENT and outbox COMPLETED", async () => {
      const res = await processPendingWhatsAppOutbox(
        tenantAContext,
        mockClient,
      );
      expect(res.processed).toBeGreaterThanOrEqual(1);

      // Verify message in DB transitioned to SENT with valid wamid
      const dbMsg = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, wamid FROM whatsapp_messages WHERE id = $1`,
            [messageId],
          );
          return r.rows[0];
        },
      );
      expect(dbMsg.status).toBe("SENT");
      expect(dbMsg.wamid).toMatch(/^wamid\./);

      // Verify outbox event is COMPLETED
      const dbOutbox = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status FROM outbox_events WHERE organization_id = $1 AND payload->>'messageId' = $2`,
            [tenantAContext.organizationId, messageId],
          );
          return r.rows[0];
        },
      );
      expect(dbOutbox.status).toBe("COMPLETED");
    });

    it("transitions message to UNKNOWN on network timeout and suppresses blind outbox retries", async () => {
      let dispatchCount = 0;
      const flakyClient = new MockWhatsAppApiClient();
      flakyClient.sendText = async () => {
        dispatchCount++;
        const err: any = new Error("connect ETIMEDOUT");
        err.code = "ETIMEDOUT";
        throw err;
      };

      const record = await sendWhatsAppMessage(tenantAContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: "+201077776666",
        text: "Ambiguous timeout message",
      });

      // First outbox sweep: provider fails with timeout
      const res1 = await processPendingWhatsAppOutbox(
        tenantAContext,
        flakyClient,
      );
      expect(res1.failed).toBeGreaterThanOrEqual(1);
      expect(dispatchCount).toBe(1);

      // Verify message is UNKNOWN
      const dbMsg = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, wamid FROM whatsapp_messages WHERE id = $1`,
            [record.id],
          );
          return r.rows[0];
        },
      );
      expect(dbMsg.status).toBe("UNKNOWN");
      expect(dbMsg.wamid).toBeNull();

      // Verify outbox event is marked FAILED with max_retries (terminal)
      const dbOutbox = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, retry_count, max_retries FROM outbox_events WHERE organization_id = $1 AND payload->>'messageId' = $2`,
            [tenantAContext.organizationId, record.id],
          );
          return r.rows[0];
        },
      );
      expect(dbOutbox.status).toBe("FAILED");
      expect(dbOutbox.retry_count).toBe(dbOutbox.max_retries);

      // Second outbox sweep: must NOT dispatch again (blind retry strictly suppressed)
      const res2 = await processPendingWhatsAppOutbox(
        tenantAContext,
        flakyClient,
      );
      expect(dispatchCount).toBe(1); // Provider was not called a second time!
    });
  });

  describe("3. Outbox Leases & Missing Handler Resiliency", () => {
    it("automatically transitions a stale PROCESSING event to FAILED if retry_count >= max_retries", async () => {
      const key = `exhausted-stale-${crypto.randomUUID()}`;
      await withTenantContext(tenantAContext.organizationId, async (tx) => {
        await tx.query(
          `INSERT INTO outbox_events (
            organization_id, event_type, payload, idempotency_key,
            status, retry_count, max_retries, processing_started_at, worker_id, created_at, updated_at
          ) VALUES ($1, 'test.exhausted_stale', '{}', $2, 'PROCESSING', 5, 5, NOW() - INTERVAL '10 minutes', 'crashed', NOW(), NOW())`,
          [tenantAContext.organizationId, key],
        );
      });

      let called = false;
      const res = await processPendingOutboxEvents(tenantAContext, {
        "test.exhausted_stale": async () => {
          called = true;
        },
      });

      expect(called).toBe(false);

      const dbEvent = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, last_error FROM outbox_events WHERE idempotency_key = $1`,
            [key],
          );
          return r.rows[0];
        },
      );
      expect(dbEvent.status).toBe("FAILED"); // Cleanly transitioned to FAILED
      expect(dbEvent.last_error).toMatch(/lease expired/i);
    });

    it("marks unregistered event type as terminal FAILED with retry_count = max_retries", async () => {
      const key = `missing-handler-term-${crypto.randomUUID()}`;
      await withTenantContext(tenantAContext.organizationId, async (tx) => {
        await enqueueOutboxEvent(
          tx,
          tenantAContext,
          "test.unregistered_terminal",
          { foo: "bar" },
          key,
        );
      });

      // First run: fails with missing handler
      const res1 = await processPendingOutboxEvents(tenantAContext, {});
      expect(res1.failed).toBeGreaterThanOrEqual(1);

      const dbEvent = await withTenantContext(
        tenantAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, retry_count, max_retries, last_error FROM outbox_events WHERE idempotency_key = $1`,
            [key],
          );
          return r.rows[0];
        },
      );
      expect(dbEvent.status).toBe("FAILED");
      expect(dbEvent.retry_count).toBe(dbEvent.max_retries);

      // Second run: must NOT pick it up again
      const res2 = await processPendingOutboxEvents(tenantAContext, {});
      expect(res2.processed).toBe(0);
      expect(res2.failed).toBe(0);
    });
  });

  describe("4. Runtime DB Role Fixed Name & Provisioning Security", () => {
    it("rejects configuring runtime database role with a username other than app_user", async () => {
      await expect(
        provisionRuntimeDbRoles(undefined, {
          username: "custom_incompatible_role",
          nodeEnv: "development",
        }),
      ).rejects.toThrow(RoleProvisioningError);
    });
  });
});
