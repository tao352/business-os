import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  createLead,
  createRule,
  triggerRules,
  configureWhatsAppIntegration,
  sendWhatsAppMessage,
  processPendingWhatsAppOutbox,
  MockWhatsAppApiClient,
} from "../packages/core/src/index.js";
import {
  enqueueOutboxEvent,
  processPendingOutboxEvents,
} from "../packages/core/src/rules/outbox-service.js";

describe("H0 Stabilization Patch v2.3 — Unified WhatsApp Outbox & Idempotency Hardening", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let tenantContext: TenantContext;
  let mockClient: MockWhatsAppApiClient;
  const waPhoneId = `wa_phone_v23_${uniqueSuffix}`;

  beforeAll(async () => {
    mockClient = new MockWhatsAppApiClient();

    // Tenant setup
    const user = await registerUser({
      email: `owner.v23.${uniqueSuffix}@test.local`,
      password: "StrongPassword2026!",
      fullName: "Tenant v2.3 Owner",
    });
    const org = await createOrganization({
      userId: user.id,
      name: `Tenant v2.3 ${uniqueSuffix}`,
      slug: `tenant-v23-${uniqueSuffix}`,
    });
    tenantContext = {
      userId: user.id,
      organizationId: org.id,
      role: "OWNER",
      correlationId: `test-v23-${uniqueSuffix}`,
    };

    // Configure WhatsApp Integration
    await configureWhatsAppIntegration(tenantContext, {
      phoneNumberId: waPhoneId,
      wabaId: `waba_${uniqueSuffix}`,
      accessToken: "v23_token_valid",
      verifyToken: "v23_verify",
      displayPhoneNumber: "+201099998888",
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("1. Smart Rules WhatsApp Unified Outbox Path", () => {
    it("enqueues whatsapp.send_outbound without inline execution, and worker delivers message", async () => {
      // 1. Create Smart Rule with whatsapp.send_template
      const rule = await createRule(tenantContext, {
        name: `Automated VIP Welcome ${uniqueSuffix}`,
        trigger_type: "lead.created",
        conditions: [
          {
            field: "source",
            operator: "equals",
            value: "VIP_OUTBOX_CAMPAIGN",
          },
        ],
        actions: [
          {
            action_type: "whatsapp.send_template",
            params: {
              template_name: "unified_vip_welcome",
              language: "ar",
              variables: ["أشرف", "Taj City"],
            },
            delay_seconds: 0,
          },
        ],
      });
      expect(rule.id).toBeDefined();

      // 2. Create matching Lead
      const recipientPhone = `+20114444${uniqueSuffix.slice(0, 4)}`;
      const lead = await createLead(tenantContext, {
        fullName: "أشرف مروان",
        phone: recipientPhone,
        source: "VIP_OUTBOX_CAMPAIGN",
      });

      // 3. Trigger Smart Rules: zero inline network calls occur
      const executions = await triggerRules(
        tenantContext,
        "lead.created",
        "lead",
        lead,
      );
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe("SUCCESS");
      expect(executions[0].actionsExecuted[0].action_type).toBe(
        "whatsapp.send_template",
      );

      // Verify provider has NOT received any dispatch prior to outbox worker execution
      expect(
        mockClient.sentTemplates.find(
          (t) => t.recipientPhone === recipientPhone,
        ),
      ).toBeUndefined();

      // Verify message in DB is PENDING with NULL wamid
      const dbMsgBefore = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT id, status, wamid, message_type FROM whatsapp_messages WHERE lead_id = $1`,
            [lead.id],
          );
          return r.rows[0];
        },
      );
      expect(dbMsgBefore).toBeDefined();
      expect(dbMsgBefore.status).toBe("PENDING");
      expect(dbMsgBefore.wamid).toBeNull();
      expect(dbMsgBefore.message_type).toBe("template");

      // Verify outbox event in DB has event_type = 'whatsapp.send_outbound'
      const outboxBefore = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, event_type FROM outbox_events WHERE organization_id = $1 AND payload->>'messageId' = $2`,
            [tenantContext.organizationId, dbMsgBefore.id],
          );
          return r.rows[0];
        },
      );
      expect(outboxBefore).toBeDefined();
      expect(outboxBefore.status).toBe("PENDING");
      expect(outboxBefore.event_type).toBe("whatsapp.send_outbound");

      // 4. Run outbox worker
      const outboxRes = await processPendingWhatsAppOutbox(
        tenantContext,
        mockClient,
      );
      expect(outboxRes.processed).toBeGreaterThanOrEqual(1);

      // Verify provider received dispatch
      const sent = mockClient.sentTemplates.find(
        (t) => t.recipientPhone === recipientPhone,
      );
      expect(sent).toBeDefined();
      expect(sent?.templateName).toBe("unified_vip_welcome");
      expect(sent?.variables).toEqual(["أشرف", "Taj City"]);

      // Verify message in DB transitioned to SENT with wamid
      const dbMsgAfter = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, wamid FROM whatsapp_messages WHERE id = $1`,
            [dbMsgBefore.id],
          );
          return r.rows[0];
        },
      );
      expect(dbMsgAfter.status).toBe("SENT");
      expect(dbMsgAfter.wamid).toMatch(/^wamid\./);

      // Verify activity was recorded on lead timeline
      const activities = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT * FROM activities WHERE organization_id = $1 AND lead_id = $2 AND activity_type = 'WHATSAPP'`,
            [tenantContext.organizationId, lead.id],
          );
          return r.rows;
        },
      );
      expect(activities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("2. Elimination of Crash-After-Send Duplicate Window", () => {
    it("transitions SENDING message to UNKNOWN and terminates retries on recovery", async () => {
      const recipient = "+201011112222";
      let providerCalled = false;
      const testClient = new MockWhatsAppApiClient();
      testClient.sendText = async () => {
        providerCalled = true;
        return { wamid: "wamid.unexpected" };
      };

      // 1. Enqueue message
      const msg = await sendWhatsAppMessage(tenantContext, {
        phoneNumberId: waPhoneId,
        recipientPhone: recipient,
        text: "Important Notice",
      });

      // 2. Simulate worker crash after transition to SENDING
      await withTenantContext(tenantContext.organizationId, async (tx) => {
        await tx.query(
          `UPDATE whatsapp_messages SET status = 'SENDING' WHERE id = $1`,
          [msg.id],
        );
      });

      // 3. Worker claims lease and runs handleWhatsAppOutboundEvent
      const outboxRes = await processPendingWhatsAppOutbox(
        tenantContext,
        testClient,
      );

      // Provider must NEVER be called!
      expect(providerCalled).toBe(false);
      expect(outboxRes.failed).toBeGreaterThanOrEqual(1);

      // Message in DB must be transitioned to UNKNOWN
      const dbMsg = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status FROM whatsapp_messages WHERE id = $1`,
            [msg.id],
          );
          return r.rows[0];
        },
      );
      expect(dbMsg.status).toBe("UNKNOWN");

      // Outbox event must be FAILED with retry_count = max_retries (terminal dead letter)
      const dbOutbox = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, retry_count, max_retries, last_error FROM outbox_events WHERE payload->>'messageId' = $1`,
            [msg.id],
          );
          return r.rows[0];
        },
      );
      expect(dbOutbox.status).toBe("FAILED");
      expect(dbOutbox.retry_count).toBe(dbOutbox.max_retries);
      expect(dbOutbox.last_error).toMatch(/already in SENDING status/i);

      // 4. Subsequent worker sweep must NOT attempt resend
      providerCalled = false;
      const secondSweep = await processPendingWhatsAppOutbox(
        tenantContext,
        testClient,
      );
      expect(providerCalled).toBe(false);
      expect(secondSweep.processed).toBe(0);
    });
  });

  describe("3. Real Manual-Send API Idempotency", () => {
    it("returns identical message record on retry without creating orphan or duplicate records", async () => {
      const idempotencyKey = `idemp-${crypto.randomUUID()}`;
      const recipient = "+201088887777";

      // First call
      const msg1 = await sendWhatsAppMessage(
        tenantContext,
        {
          phoneNumberId: waPhoneId,
          recipientPhone: recipient,
          text: "Idempotent Message Test",
        },
        undefined,
        { idempotencyKey },
      );

      expect(msg1.id).toBeDefined();
      expect(msg1.status).toBe("PENDING");

      // Second call with same idempotencyKey (client retry)
      const msg2 = await sendWhatsAppMessage(
        tenantContext,
        {
          phoneNumberId: waPhoneId,
          recipientPhone: recipient,
          text: "Idempotent Message Test",
        },
        undefined,
        { idempotencyKey },
      );

      // Must return identical record ID
      expect(msg2.id).toBe(msg1.id);

      // Verify whatsapp_messages table has exactly 1 row for this idempotency_key
      const msgCount = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT COUNT(*)::int as cnt FROM whatsapp_messages WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, idempotencyKey],
          );
          return r.rows[0].cnt;
        },
      );
      expect(msgCount).toBe(1);

      // Verify outbox_events table has exactly 1 row for this idempotency_key
      const outboxCount = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT COUNT(*)::int as cnt FROM outbox_events WHERE organization_id = $1 AND idempotency_key = $2`,
            [tenantContext.organizationId, idempotencyKey],
          );
          return r.rows[0].cnt;
        },
      );
      expect(outboxCount).toBe(1);
    });

    it("returns existing message record if duplicate messageId is supplied", async () => {
      const explicitMessageId = crypto.randomUUID();
      const recipient = "+201033334444";

      const msg1 = await sendWhatsAppMessage(
        tenantContext,
        {
          phoneNumberId: waPhoneId,
          recipientPhone: recipient,
          text: "Explicit ID Test",
        },
        undefined,
        { messageId: explicitMessageId },
      );
      expect(msg1.id).toBe(explicitMessageId);

      // Re-call with same messageId
      const msg2 = await sendWhatsAppMessage(
        tenantContext,
        {
          phoneNumberId: waPhoneId,
          recipientPhone: recipient,
          text: "Explicit ID Test",
        },
        undefined,
        { messageId: explicitMessageId },
      );
      expect(msg2.id).toBe(explicitMessageId);
    });
  });

  describe("4. Auto-Transition Exhausted Stale PROCESSING to FAILED", () => {
    it("transitions an expired PROCESSING event with max retries to FAILED", async () => {
      const key = `auto-fail-stale-${crypto.randomUUID()}`;
      await withTenantContext(tenantContext.organizationId, async (tx) => {
        await tx.query(
          `INSERT INTO outbox_events (
            organization_id, event_type, payload, idempotency_key,
            status, retry_count, max_retries, processing_started_at, worker_id, created_at, updated_at
          ) VALUES ($1, 'test.exhausted_stale_v23', '{}', $2, 'PROCESSING', 5, 5, NOW() - INTERVAL '10 minutes', 'crashed-v23', NOW(), NOW())`,
          [tenantContext.organizationId, key],
        );
      });

      // Run outbox sweep
      await processPendingOutboxEvents(tenantContext, {});

      // Verify status is cleanly FAILED
      const dbEvent = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            `SELECT status, last_error FROM outbox_events WHERE idempotency_key = $1`,
            [key],
          );
          return r.rows[0];
        },
      );
      expect(dbEvent.status).toBe("FAILED");
      expect(dbEvent.last_error).toMatch(/lease expired/i);
    });
  });
});
