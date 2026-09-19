import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import {
  pool,
  withTenantContext,
  Client,
} from "../packages/database/src/index.js";
import type { TenantContext, MetaLeadDetails } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  configureMetaIntegration,
  configureWhatsAppIntegration,
  sendWhatsAppMessage,
  ingestMetaLead,
  MockWhatsAppApiClient,
} from "../packages/core/src/index.js";
import {
  enqueueOutboxEvent,
  processPendingOutboxEvents,
} from "../packages/core/src/rules/outbox-service.js";
import { executeRuleAction } from "../packages/core/src/rules/rule-actions-executor.js";
import {
  provisionRuntimeDbRoles,
  RoleProvisioningError,
} from "../scripts/provision-db-roles.js";

describe("H0 Stabilization Patch v2.1 Verification", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let tenantContext: TenantContext;
  let metaPageId: string;
  let waPhoneId: string;
  let appClient: Client;

  beforeAll(async () => {
    // 1. Setup tenant & user
    const user = await registerUser({
      email: `owner.h0v21.${uniqueSuffix}@test.local`,
      password: "StrongPassword2026!",
      fullName: "H0 Stabilization Owner",
    });
    const org = await createOrganization({
      userId: user.id,
      name: `H0 Stabilization Org ${uniqueSuffix}`,
      slug: `h0-v21-${uniqueSuffix}`,
    });
    tenantContext = {
      userId: user.id,
      organizationId: org.id,
      role: "OWNER",
      correlationId: `test-h0-v21-${uniqueSuffix}`,
    };

    // 2. Configure Meta & WhatsApp integrations
    metaPageId = `page_v21_${uniqueSuffix}`;
    await configureMetaIntegration(tenantContext, {
      pageId: metaPageId,
      pageName: "H0 Test Page",
      pageAccessToken: "EAA_test_token_v21",
      appSecret: "app_secret_v21",
      verifyToken: "verify_token_v21",
    });

    waPhoneId = `phone_v21_${uniqueSuffix}`;
    await configureWhatsAppIntegration(tenantContext, {
      wabaId: `waba_v21_${uniqueSuffix}`,
      phoneNumberId: waPhoneId,
      displayPhoneNumber: "+201099990001",
      accessToken: "wa_token_v21",
      appSecret: "wa_secret_v21",
      verifyToken: "wa_verify_v21",
    });

    // 3. Connect unprivileged app_user client
    appClient = new Client({
      connectionString:
        process.env.APP_DATABASE_URL ||
        "postgres://app_user:app_password@localhost:5432/business_os",
    });
    await appClient.connect();
  });

  afterAll(async () => {
    await appClient.end();
    await pool.end();
  });

  describe("1. SECURITY DEFINER Pre-Routing & Least Privilege app_user", () => {
    it("should prevent direct unscoped reads from meta_integrations under FORCE RLS", async () => {
      const res = await appClient.query(
        "SELECT * FROM public.meta_integrations",
      );
      expect(res.rows.length).toBe(0);
    });

    it("should prevent direct unscoped reads from whatsapp_integrations under FORCE RLS", async () => {
      const res = await appClient.query(
        "SELECT * FROM public.whatsapp_integrations",
      );
      expect(res.rows.length).toBe(0);
    });

    it("should resolve Meta tenant via SECURITY DEFINER router without exposing secrets", async () => {
      const res = await appClient.query(
        "SELECT * FROM public.resolve_meta_tenant($1)",
        [metaPageId],
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].organization_id).toBe(tenantContext.organizationId);
      expect(res.rows[0].integration_id).toBeDefined();
      expect(res.rows[0].page_access_token).toBeUndefined();
      expect(res.rows[0].app_secret).toBeUndefined();
    });

    it("should resolve WhatsApp tenant via SECURITY DEFINER router without exposing secrets", async () => {
      const res = await appClient.query(
        "SELECT * FROM public.resolve_whatsapp_tenant($1)",
        [waPhoneId],
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].organization_id).toBe(tenantContext.organizationId);
      expect(res.rows[0].integration_id).toBeDefined();
      expect(res.rows[0].access_token).toBeUndefined();
      expect(res.rows[0].app_secret).toBeUndefined();
    });
  });

  describe("2. Runtime DB Role Provisioning Fail-Closed Guard", () => {
    it("should reject passwords under 16 characters in production", async () => {
      await expect(
        provisionRuntimeDbRoles(undefined, {
          nodeEnv: "production",
          password: "short_pw",
        }),
      ).rejects.toThrow(RoleProvisioningError);
    });

    it("should reject default or trivial passwords in production", async () => {
      await expect(
        provisionRuntimeDbRoles(undefined, {
          nodeEnv: "production",
          password: "app_password_with_16_chars",
        }),
      ).rejects.toThrow(RoleProvisioningError);
    });

    it("should accept valid configuration in development", async () => {
      const result = await provisionRuntimeDbRoles(undefined, {
        nodeEnv: "development",
        password: "app_password",
      });
      expect(result.username).toBe("app_user");
      expect(result.provisioned).toBe(true);
    });
  });

  describe("3. Outbox Leases, Crash Recovery & Handler Resiliency", () => {
    it("should reclaim orphaned PROCESSING outbox events whose lease expired (> 5 min)", async () => {
      const eventKey = `expired-lease-${crypto.randomUUID()}`;
      await withTenantContext(tenantContext.organizationId, async (tx) => {
        await tx.query(
          `INSERT INTO outbox_events (
            organization_id, event_type, payload, idempotency_key,
            status, processing_started_at, worker_id, created_at, updated_at
          ) VALUES ($1, 'test.expired_lease', '{}', $2, 'PROCESSING', NOW() - INTERVAL '6 minutes', 'crashed-worker', NOW(), NOW())`,
          [tenantContext.organizationId, eventKey],
        );
      });

      let handlerInvoked = false;
      const res = await processPendingOutboxEvents(tenantContext, {
        "test.expired_lease": async () => {
          handlerInvoked = true;
        },
      });

      expect(handlerInvoked).toBe(true);
      expect(res.processed).toBeGreaterThanOrEqual(1);

      const dbEvent = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT status, worker_id FROM outbox_events WHERE idempotency_key = $1",
            [eventKey],
          );
          return r.rows[0];
        },
      );
      expect(dbEvent.status).toBe("COMPLETED");
      expect(dbEvent.worker_id).not.toBe("crashed-worker");
    });

    it("should mark outbox event FAILED if handler is missing instead of leaving stuck in PROCESSING", async () => {
      const eventKey = `missing-handler-${crypto.randomUUID()}`;
      await withTenantContext(tenantContext.organizationId, async (tx) => {
        await enqueueOutboxEvent(
          tx,
          tenantContext,
          "test.unregistered_type",
          { foo: "bar" },
          eventKey,
        );
      });

      const res = await processPendingOutboxEvents(tenantContext, {});
      expect(res.failed).toBeGreaterThanOrEqual(1);

      const dbEvent = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT status, last_error FROM outbox_events WHERE idempotency_key = $1",
            [eventKey],
          );
          return r.rows[0];
        },
      );
      expect(dbEvent.status).toBe("FAILED");
      expect(dbEvent.last_error).toContain(
        "No handler registered for event type",
      );
    });
  });

  describe("4. Execution-Level Idempotency in Smart Rule Actions", () => {
    it("should deduplicate within the same execution and allow distinct executions", async () => {
      const leadRes = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "INSERT INTO leads (organization_id, full_name, phone, status) VALUES ($1, 'Idempotent Lead', '+201012345678', 'NEW') RETURNING *",
            [tenantContext.organizationId],
          );
          return r.rows[0];
        },
      );

      const action = {
        id: "act-1",
        action_type: "whatsapp.send_template" as const,
        params: { template_name: "welcome_v21" },
        order_index: 0,
      };

      const executionId1 = `exec-run-1-${crypto.randomUUID()}`;
      const executionId2 = `exec-run-2-${crypto.randomUUID()}`;

      // Execution 1 - First attempt
      const res1 = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          return await executeRuleAction(
            tx,
            tenantContext,
            "rule-123",
            action,
            "lead",
            leadRes,
            { executionId: executionId1, actionIndex: 0 },
          );
        },
      );
      expect(res1.status).toBe("SUCCESS");

      // Execution 1 - Retry attempt with same executionId
      const res1Retry = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          return await executeRuleAction(
            tx,
            tenantContext,
            "rule-123",
            action,
            "lead",
            leadRes,
            { executionId: executionId1, actionIndex: 0 },
          );
        },
      );
      expect(res1Retry.status).toBe("SUCCESS");
      expect(res1Retry.result?.outboxId).toBe(res1.result?.outboxId);

      // Execution 2 - Distinct legitimate run
      const res2 = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          return await executeRuleAction(
            tx,
            tenantContext,
            "rule-123",
            action,
            "lead",
            leadRes,
            { executionId: executionId2, actionIndex: 0 },
          );
        },
      );
      expect(res2.status).toBe("SUCCESS");
      expect(res2.result?.outboxId).toBeDefined();
    });
  });

  describe("5. Meta Ingestion & WhatsApp Durable Semantics", () => {
    it("should ingest meta lead outside graph fetch transaction", async () => {
      const leadgenId = `leadgen_v21_${uniqueSuffix}`;
      const details: MetaLeadDetails = {
        id: leadgenId,
        form_id: "form_v21",
        platform: "fb",
        field_data: [
          { name: "full_name", values: ["Tamer Hosny"] },
          {
            name: "phone_number",
            values: [`+20108877${uniqueSuffix.slice(0, 4)}`],
          },
        ],
      };

      const res = await ingestMetaLead(tenantContext, {
        pageId: metaPageId,
        leadgenId,
        leadDetails: details,
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe("CREATED");
    });

    it("should mark WhatsApp message as UNKNOWN on ambiguous network timeout", async () => {
      const timeoutClient = new MockWhatsAppApiClient();
      timeoutClient.sendText = async () => {
        const err: any = new Error("connect ETIMEDOUT 157.240.1.1:443");
        err.code = "ETIMEDOUT";
        throw err;
      };

      await expect(
        sendWhatsAppMessage(
          tenantContext,
          {
            phoneNumberId: waPhoneId,
            recipientPhone: "+201055556666",
            text: "Testing network timeout",
          },
          timeoutClient,
        ),
      ).rejects.toThrow(/ETIMEDOUT/);

      const msg = await withTenantContext(
        tenantContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT status, wamid FROM whatsapp_messages WHERE recipient_phone = $1",
            ["+201055556666"],
          );
          return r.rows[0];
        },
      );

      expect(msg).toBeDefined();
      expect(msg.status).toBe("UNKNOWN");
      expect(msg.wamid).toBeNull();
    });
  });
});
