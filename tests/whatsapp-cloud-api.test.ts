import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext, WhatsAppWebhookPayload } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  createLead,
  createRule,
  triggerRules,
  configureWhatsAppIntegration,
  sendWhatsAppMessage,
  processPendingWhatsAppOutbox,
  processWhatsAppWebhookPayload,
  verifyWhatsAppSignature,
  signWhatsAppPayload,
  verifyWhatsAppWebhookChallenge,
  MockWhatsAppApiClient,
} from "../packages/core/src/index.js";

describe("Phase 11: WhatsApp Cloud API Integration (Live Tests)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  const appSecretA = "wa_secret_futtaim_2026";
  const verifyTokenA = "wa_verify_token_futtaim";
  const phoneNumberIdA = `phone_id_${uniqueSuffix}`;
  const wabaIdA = `waba_${uniqueSuffix}`;
  const displayPhoneA = "+201000000001";

  let mockClient: MockWhatsAppApiClient;

  beforeAll(async () => {
    mockClient = new MockWhatsAppApiClient();

    // 1. Setup Org A (Al Futtaim)
    const ownerA = await registerUser({
      email: `owner.futtaim.${uniqueSuffix}@futtaim.local`,
      password: "StrongPassword2026!",
      fullName: "Omar Al Futtaim",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Al Futtaim Group ${uniqueSuffix}`,
      slug: `futtaim-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `test-wa-org-a-${uniqueSuffix}`,
    };

    // 3. Setup Org B (Majid Al Futtaim)
    const ownerB = await registerUser({
      email: `owner.maf.${uniqueSuffix}@maf.local`,
      password: "StrongPassword2026!",
      fullName: "Majid Al Futtaim",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `MAF Properties ${uniqueSuffix}`,
      slug: `maf-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `test-wa-org-b-${uniqueSuffix}`,
    };
  });

  describe("1. Cryptographic Signature & Webhook Challenge Verification", () => {
    const rawPayload = JSON.stringify({
      object: "whatsapp_business_account",
      time: Date.now(),
    });

    it("verifies valid HMAC signature using app secret", () => {
      const signature = signWhatsAppPayload(rawPayload, appSecretA);
      expect(verifyWhatsAppSignature(rawPayload, signature, appSecretA)).toBe(
        true,
      );
    });

    it("rejects invalid or tampered signature", () => {
      const signature = signWhatsAppPayload(rawPayload, "wrong_secret");
      expect(verifyWhatsAppSignature(rawPayload, signature, appSecretA)).toBe(
        false,
      );
    });

    it("verifies WhatsApp GET challenge handshake", () => {
      const challenge = "wa_challenge_string_7788";
      const res = verifyWhatsAppWebhookChallenge(
        {
          "hub.mode": "subscribe",
          "hub.verify_token": verifyTokenA,
          "hub.challenge": challenge,
        },
        verifyTokenA,
      );
      expect(res.isValid).toBe(true);
      expect(res.challenge).toBe(challenge);
    });
  });

  describe("2. WhatsApp Integration Configuration", () => {
    it("configures WhatsApp Business Account for Org A", async () => {
      const integration = await configureWhatsAppIntegration(orgAContext, {
        phoneNumberId: phoneNumberIdA,
        wabaId: wabaIdA,
        phoneNumber: displayPhoneA,
        accessToken: "EAAB_test_wa_access_token",
        appSecret: appSecretA,
        verifyToken: verifyTokenA,
      });

      expect(integration.id).toBeDefined();
      expect(integration.phoneNumberId).toBe(phoneNumberIdA);
      expect(integration.organizationId).toBe(orgAContext.organizationId);
      expect(integration.isActive).toBe(true);
    });
  });

  describe("3. Outbound Message Dispatching (Templates & Text)", () => {
    let leadId: string;
    const clientPhone = `+2012345678${uniqueSuffix.slice(0, 2)}`;

    beforeAll(async () => {
      const lead = await createLead(orgAContext, {
        fullName: "ياسر جلال",
        phone: clientPhone,
      });
      leadId = lead.id;
    });

    it("dispatches outbound template message and logs timeline activity", async () => {
      const message = await sendWhatsAppMessage(orgAContext, {
        phoneNumberId: phoneNumberIdA,
        recipientPhone: clientPhone,
        templateName: "cairo_festival_city_launch",
        variables: ["ياسر جلال", "Townhouse Prime"],
        leadId,
      });

      expect(message.id).toBeDefined();
      expect(message.direction).toBe("OUTBOUND");
      expect(message.messageType).toBe("template");
      expect(message.status).toBe("PENDING");
      expect(message.wamid).toBeNull();

      // Process outbox to dispatch via provider
      const outboxRes = await processPendingWhatsAppOutbox(
        orgAContext,
        mockClient,
      );
      expect(outboxRes.processed).toBeGreaterThanOrEqual(1);

      // Verify Recorded in Database
      const dbMsg = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM whatsapp_messages WHERE id = $1",
            [message.id],
          );
          return res.rows[0];
        },
      );
      expect(dbMsg.recipient_phone).toBe(clientPhone);
      expect(dbMsg.status).toBe("SENT");
      expect(dbMsg.wamid).toMatch(/^wamid\./);

      // Verify Timeline Activity Logged
      const activities = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM activities WHERE lead_id = $1 AND activity_type = $2",
            [leadId, "WHATSAPP"],
          );
          return res.rows;
        },
      );
      expect(activities.length).toBeGreaterThanOrEqual(1);
      expect(activities[0].summary).toContain("Outbound WhatsApp template");
    });

    it("dispatches outbound free-form text message", async () => {
      const textMsg = await sendWhatsAppMessage(orgAContext, {
        phoneNumberId: phoneNumberIdA,
        recipientPhone: clientPhone,
        text: "مرحباً أستاذ ياسر، تم تأكيد موعد زيارة مشروع كايرو فيستيفال سيتي غداً.",
        leadId,
      });

      expect(textMsg.messageType).toBe("text");
      expect(textMsg.status).toBe("PENDING");
      expect(textMsg.body).toContain("كايرو فيستيفال سيتي");

      const outboxRes = await processPendingWhatsAppOutbox(
        orgAContext,
        mockClient,
      );
      expect(outboxRes.processed).toBeGreaterThanOrEqual(1);

      const dbMsg = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM whatsapp_messages WHERE id = $1",
            [textMsg.id],
          );
          return res.rows[0];
        },
      );
      expect(dbMsg.status).toBe("SENT");
      expect(dbMsg.wamid).toMatch(/^wamid\./);
    });
  });

  describe("4. Inbound Webhook Processing & Lead Capture", () => {
    const existingClientPhone = `+2012345678${uniqueSuffix.slice(0, 2)}`;
    const newClientPhone = `+2015887766${uniqueSuffix.slice(0, 2)}`;

    it("attaches inbound message to existing lead and appends activity", async () => {
      const inboundPayload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: wabaIdA,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: displayPhoneA,
                    phone_number_id: phoneNumberIdA,
                  },
                  messages: [
                    {
                      from: existingClientPhone,
                      id: `wamid_inbound_1_${uniqueSuffix}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: "أنا في طريقي للمعانية الآن، شكراً لكم." },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await processWhatsAppWebhookPayload(inboundPayload);
      expect(result.messagesProcessed).toBe(1);
      expect(result.leadsUpdated).toBe(1);
      expect(result.leadsCreated).toBe(0);

      // Verify activity recorded on existing lead
      const activities = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            `SELECT a.* FROM activities a
           JOIN leads l ON l.id = a.lead_id
           WHERE l.phone = $1 AND a.activity_type = 'WHATSAPP'
           ORDER BY a.created_at DESC`,
            [existingClientPhone],
          );
          return res.rows;
        },
      );

      expect(activities[0].summary).toContain("Inbound WhatsApp");
      expect(activities[0].details.body).toBe(
        "أنا في طريقي للمعانية الآن، شكراً لكم.",
      );
    });

    it("auto-creates new CRM lead when receiving message from unknown number", async () => {
      const inboundNewLeadPayload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: wabaIdA,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: displayPhoneA,
                    phone_number_id: phoneNumberIdA,
                  },
                  messages: [
                    {
                      from: newClientPhone,
                      id: `wamid_inbound_new_${uniqueSuffix}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: {
                        body: "مساء الخير، هل يوجد وحدات استلام فوري في التجمع؟",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await processWhatsAppWebhookPayload(inboundNewLeadPayload);
      expect(result.messagesProcessed).toBe(1);
      expect(result.leadsCreated).toBe(1);

      // Verify Lead created in CRM
      const newLead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM leads WHERE phone = $1", [
            newClientPhone,
          ]);
          return res.rows[0];
        },
      );

      expect(newLead).toBeDefined();
      expect(newLead.source).toBe("WHATSAPP");
      expect(newLead.phone).toBe(newClientPhone);
    });
  });

  describe("5. Delivery Status Updates (Read Receipts & Delivers)", () => {
    it("updates outbound message status to DELIVERED and READ upon receipt", async () => {
      // First send an outbound message to have a wamid
      const sentMsg = await sendWhatsAppMessage(orgAContext, {
        phoneNumberId: phoneNumberIdA,
        recipientPhone: "+201100110011",
        text: "Receipt Test Message",
      });

      await processPendingWhatsAppOutbox(orgAContext, mockClient);
      const dbSent = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT wamid FROM whatsapp_messages WHERE id = $1",
            [sentMsg.id],
          );
          return res.rows[0];
        },
      );
      const targetWamid = dbSent.wamid;

      // Simulate status payload from WhatsApp
      const statusPayload: WhatsAppWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: wabaIdA,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: displayPhoneA,
                    phone_number_id: phoneNumberIdA,
                  },
                  statuses: [
                    {
                      id: targetWamid,
                      status: "delivered",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: "+201100110011",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const res = await processWhatsAppWebhookPayload(statusPayload);
      expect(res.statusesUpdated).toBe(1);

      // Verify in database
      const msgDelivered = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT status FROM whatsapp_messages WHERE wamid = $1",
            [targetWamid],
          );
          return r.rows[0];
        },
      );
      expect(msgDelivered.status).toBe("DELIVERED");

      // Now update to read
      statusPayload.entry[0].changes[0].value.statuses![0].status = "read";
      await processWhatsAppWebhookPayload(statusPayload);

      const msgRead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT status FROM whatsapp_messages WHERE wamid = $1",
            [targetWamid],
          );
          return r.rows[0];
        },
      );
      expect(msgRead.status).toBe("READ");
    });
  });

  describe("6. Smart Rules Integration (Automated WhatsApp Message on Lead Creation)", () => {
    it("automatically dispatches WhatsApp welcome template when new lead is created", async () => {
      // 1. Create Smart Rule in Org A
      const rule = await createRule(orgAContext, {
        name: "Instant WhatsApp Welcome on Lead Creation",
        trigger_type: "lead.created",
        conditions: [
          {
            field: "source",
            operator: "equals",
            value: "VIP_CAMPAIGN",
          },
        ],
        actions: [
          {
            action_type: "whatsapp.send_template",
            params: {
              template_name: "instant_vip_welcome",
              language: "ar",
            },
            delay_seconds: 0,
          },
        ],
      });

      expect(rule.id).toBeDefined();

      // 2. Create Lead that matches rule
      const vipPhone = `+2012991122${uniqueSuffix.slice(0, 2)}`;
      const lead = await createLead(orgAContext, {
        fullName: "أشرف عبد الباقي",
        phone: vipPhone,
        source: "VIP_CAMPAIGN",
      });

      // 3. Trigger Smart Rules (enqueue outbox event, zero inline provider calls)
      const executions = await triggerRules(
        orgAContext,
        "lead.created",
        "lead",
        lead,
      );

      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe("SUCCESS");
      expect(executions[0].actionsExecuted[0].action_type).toBe(
        "whatsapp.send_template",
      );

      // Prior to outbox worker execution, provider has received 0 dispatches
      expect(
        mockClient.sentTemplates.find((t) => t.recipientPhone === vipPhone),
      ).toBeUndefined();

      // 4. Process pending outbox events via worker
      const outboxRes = await processPendingWhatsAppOutbox(
        orgAContext,
        mockClient,
      );
      expect(outboxRes.processed).toBeGreaterThanOrEqual(1);

      // Verify mockClient received the template dispatch
      const sent = mockClient.sentTemplates.find(
        (t) => t.recipientPhone === vipPhone,
      );
      expect(sent).toBeDefined();
      expect(sent?.templateName).toBe("instant_vip_welcome");

      // Verify message logged in whatsapp_messages table with status SENT
      const waMsgs = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM whatsapp_messages WHERE lead_id = $1",
            [lead.id],
          );
          return res.rows;
        },
      );
      expect(waMsgs).toHaveLength(1);
      expect(waMsgs[0].direction).toBe("OUTBOUND");
      expect(waMsgs[0].status).toBe("SENT");
    });
  });

  describe("7. Multi-Tenant Isolation (Zero Leak Invariant)", () => {
    it("strictly isolates WhatsApp integrations and messages between Org A and Org B", async () => {
      // Org B queries integrations
      const orgBIntegrations = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM whatsapp_integrations");
          return res.rows;
        },
      );
      expect(orgBIntegrations).toHaveLength(0);

      // Org B queries messages
      const orgBMessages = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM whatsapp_messages");
          return res.rows;
        },
      );
      expect(orgBMessages).toHaveLength(0);

      // Org B trying to send with Org A's phoneNumberId fails
      await expect(
        sendWhatsAppMessage(
          orgBContext,
          {
            phoneNumberId: phoneNumberIdA,
            recipientPhone: "+201111111111",
            text: "Unauthorized message",
          },
          mockClient,
        ),
      ).rejects.toThrow(/No active WhatsApp integration found/);
    });
  });
});
