import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type {
  TenantContext,
  MetaWebhookPayload,
  MetaLeadDetails,
} from "@business-os/types";
import {
  registerUser,
  createOrganization,
  configureMetaIntegration,
  ingestMetaLead,
  processMetaWebhookPayload,
  verifyMetaSignature,
  signMetaPayload,
  verifyMetaWebhookChallenge,
  parseMetaLeadData,
} from "../packages/core/src/index.js";

describe("Phase 9: Meta Lead Ads Ingestion Engine (Live Tests)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  const appSecretA = "meta_secret_key_emaar_super_secure";
  const verifyTokenA = "verify_token_marassi_2026";
  const pageIdA = `page_emaar_${uniqueSuffix}`;

  beforeAll(async () => {
    // 1. Setup Org A (Emaar Misr)
    const userA = await registerUser({
      email: `emaar.${uniqueSuffix}@marassi.local`,
      password: "StrongPassword2026!",
      fullName: "Ahmed Emaar",
    });
    const orgA = await createOrganization({
      userId: userA.id,
      name: `Emaar Misr ${uniqueSuffix}`,
      slug: `emaar-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: userA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `test-org-a-${uniqueSuffix}`,
    };

    // 3. Setup Org B (SODIC)
    const userB = await registerUser({
      email: `sodic.${uniqueSuffix}@sodic.local`,
      password: "StrongPassword2026!",
      fullName: "Tarek SODIC",
    });
    const orgB = await createOrganization({
      userId: userB.id,
      name: `SODIC West ${uniqueSuffix}`,
      slug: `sodic-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: userB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `test-org-b-${uniqueSuffix}`,
    };
  });

  describe("1. Cryptographic Signature Verification (HMAC-SHA256)", () => {
    const payload = JSON.stringify({ object: "page", time: Date.now() });

    it("validates a correct HMAC signature", () => {
      const signature = signMetaPayload(payload, appSecretA);
      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);

      const isValid = verifyMetaSignature(payload, signature, appSecretA);
      expect(isValid).toBe(true);
    });

    it("rejects tampered payload content", () => {
      const signature = signMetaPayload(payload, appSecretA);
      const tampered = payload + " ";
      const isValid = verifyMetaSignature(tampered, signature, appSecretA);
      expect(isValid).toBe(false);
    });

    it("rejects signature calculated with wrong secret", () => {
      const signature = signMetaPayload(payload, "wrong_secret_key");
      const isValid = verifyMetaSignature(payload, signature, appSecretA);
      expect(isValid).toBe(false);
    });

    it("rejects missing or malformed header formats", () => {
      expect(verifyMetaSignature(payload, null, appSecretA)).toBe(false);
      expect(verifyMetaSignature(payload, undefined, appSecretA)).toBe(false);
      expect(
        verifyMetaSignature(payload, "sha1=abcdef123456", appSecretA),
      ).toBe(false);
      expect(
        verifyMetaSignature(payload, "invalid-signature-format", appSecretA),
      ).toBe(false);
    });
  });

  describe("2. Webhook Verification Handshake (GET challenge)", () => {
    it("accepts correct token and subscribe mode", () => {
      const challenge = "challenge_random_string_998811";
      const res = verifyMetaWebhookChallenge(
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

    it("rejects incorrect token", () => {
      const res = verifyMetaWebhookChallenge(
        {
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong_token",
          "hub.challenge": "12345",
        },
        verifyTokenA,
      );
      expect(res.isValid).toBe(false);
    });
  });

  describe("3. Field Extraction & Multi-lingual Parsing", () => {
    it("parses Arabic name, phone, email and custom questions", () => {
      const leadDetails: MetaLeadDetails = {
        id: "leadgen_arabic_001",
        campaign_id: "cmp_marassi_summer",
        campaign_name: "Marassi North Coast 2026",
        ad_id: "ad_chalet_sea_view",
        ad_name: "Chalet 120m Sea View",
        form_id: "form_chalet_inquiry",
        form_name: "استمارة حجز شاليهات مراسي",
        platform: "ig",
        field_data: [
          { name: "full_name", values: ["محمود حسن الشريف"] },
          { name: "phone_number", values: ["+201012345678"] },
          { name: "email", values: ["mahmoud.hassan@example.com"] },
          { name: "ما هي ميزانيتك المتوقعة؟", values: ["7,500,000 EGP"] },
          { name: "preferred_unit", values: ["Chalet 3 Bedrooms"] },
        ],
      };

      const parsed = parseMetaLeadData(leadDetails, {
        preferred_unit: "unit_preference",
      });

      expect(parsed.fullName).toBe("محمود حسن الشريف");
      expect(parsed.phone).toBe("+201012345678");
      expect(parsed.email).toBe("mahmoud.hassan@example.com");
      expect(parsed.campaignName).toBe("Marassi North Coast 2026");
      expect(parsed.platform).toBe("ig");
      expect(parsed.customQuestions["ما هي ميزانيتك المتوقعة؟"]).toBe(
        "7,500,000 EGP",
      );
      expect(parsed.customQuestions["unit_preference"]).toBe(
        "Chalet 3 Bedrooms",
      );
    });

    it("handles separate first_name and last_name cleanly", () => {
      const leadDetails: MetaLeadDetails = {
        id: "leadgen_split_name_002",
        field_data: [
          { name: "first_name", values: ["عمر"] },
          { name: "last_name", values: ["الشريف"] },
          { name: "phone_number", values: ["+201122334455"] },
        ],
      };

      const parsed = parseMetaLeadData(leadDetails);
      expect(parsed.fullName).toBe("عمر الشريف");
      expect(parsed.phone).toBe("+201122334455");
      expect(parsed.email).toBeNull();
    });
  });

  describe("4. Meta Page Integration Configuration", () => {
    it("configures Meta integration for Org A", async () => {
      const integration = await configureMetaIntegration(orgAContext, {
        pageId: pageIdA,
        pageName: "Emaar Misr Official Page",
        pageAccessToken: "EAAB_test_mock_token_emaar_access",
        appSecret: appSecretA,
        verifyToken: verifyTokenA,
        fieldMappings: {
          preferred_bedrooms: "bedrooms",
        },
      });

      expect(integration.id).toBeDefined();
      expect(integration.pageId).toBe(pageIdA);
      expect(integration.organizationId).toBe(orgAContext.organizationId);
      expect(integration.isActive).toBe(true);
    });
  });

  describe("5. Ingestion Engine, Idempotency & Deduplication", () => {
    const leadgenId1 = `leadgen_1_${uniqueSuffix}`;
    const leadPhone = `+2010998877${uniqueSuffix.slice(0, 2)}`;

    const mockLeadDetails1: MetaLeadDetails = {
      id: leadgenId1,
      campaign_id: "cmp_cairo_gate",
      campaign_name: "Cairo Gate Sheikh Zayed",
      ad_id: "ad_villa_luxury",
      ad_name: "Townhouse 240m",
      form_id: "form_cg_01",
      form_name: "Cairo Gate Townhouses",
      platform: "fb",
      field_data: [
        { name: "full_name", values: ["كريم عبد العزيز"] },
        { name: "phone_number", values: [leadPhone] },
        { name: "email", values: ["karim.abdelaziz@cinema.local"] },
        { name: "budget", values: ["12,000,000 EGP"] },
      ],
    };

    it("successfully ingests a new lead and creates timeline activity", async () => {
      const result = await ingestMetaLead(orgAContext, {
        pageId: pageIdA,
        leadgenId: leadgenId1,
        leadDetails: mockLeadDetails1,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("CREATED");
      expect(result.leadId).toBeDefined();

      // Verify Lead in Database
      const lead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM leads WHERE id = $1", [
            result.leadId,
          ]);
          return res.rows[0];
        },
      );

      expect(lead.full_name).toBe("كريم عبد العزيز");
      expect(lead.phone).toBe(leadPhone);
      expect(lead.email).toBe("karim.abdelaziz@cinema.local");
      expect(lead.source).toBe("FACEBOOK_LEAD_ADS");
      expect(lead.campaign_id).toBe("cmp_cairo_gate");
      expect(lead.custom_data.budget).toBe("12,000,000 EGP");
      expect(lead.custom_data.meta_attribution.campaign_name).toBe(
        "Cairo Gate Sheikh Zayed",
      );

      // Verify Timeline Activity
      const activities = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM activities WHERE lead_id = $1",
            [lead.id],
          );
          return res.rows;
        },
      );

      expect(activities.length).toBeGreaterThanOrEqual(1);
      expect(activities[0].activity_type).toBe("NOTE");
      expect(activities[0].summary).toContain("Meta Lead Captured");
    });

    it("enforces idempotency on duplicate webhook retries (zero duplicate leads)", async () => {
      // Re-send the exact same leadgenId
      const retryResult = await ingestMetaLead(orgAContext, {
        pageId: pageIdA,
        leadgenId: leadgenId1,
        leadDetails: mockLeadDetails1,
      });

      expect(retryResult.success).toBe(true);
      expect(retryResult.action).toBe("DUPLICATE_IGNORED");

      // Verify only 1 lead exists with this phone
      const leads = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT id FROM leads WHERE phone = $1", [
            leadPhone,
          ]);
          return res.rows;
        },
      );
      expect(leads.length).toBe(1);

      // Verify exactly 1 webhook_events entry
      const events = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT id FROM webhook_events WHERE event_id = $1",
            [leadgenId1],
          );
          return res.rows;
        },
      );
      expect(events.length).toBe(1);
    });

    it("handles repeat submissions from existing phone by appending timeline activity", async () => {
      const leadgenId2 = `leadgen_2_${uniqueSuffix}`;
      const mockLeadDetails2: MetaLeadDetails = {
        id: leadgenId2,
        campaign_id: "cmp_marassi_resale",
        campaign_name: "Marassi Resale Offers",
        ad_id: "ad_chalet_prime",
        ad_name: "Chalet First Row",
        form_id: "form_marassi_resale",
        form_name: "Marassi Resale Form",
        platform: "ig",
        field_data: [
          { name: "full_name", values: ["كريم عبد العزيز"] },
          { name: "phone_number", values: [leadPhone] }, // Same phone!
          { name: "email", values: ["karim.abdelaziz@cinema.local"] },
          { name: "inquiry", values: ["Looking for immediate delivery"] },
        ],
      };

      const repeatResult = await ingestMetaLead(orgAContext, {
        pageId: pageIdA,
        leadgenId: leadgenId2,
        leadDetails: mockLeadDetails2,
      });

      expect(repeatResult.success).toBe(true);
      expect(repeatResult.action).toBe("UPDATED");

      // Verify still only 1 lead in database
      const leads = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM leads WHERE phone = $1", [
            leadPhone,
          ]);
          return res.rows;
        },
      );
      expect(leads.length).toBe(1);

      // Verify multiple activities logged on timeline
      const activities = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM activities WHERE lead_id = $1 ORDER BY created_at ASC",
            [leads[0].id],
          );
          return res.rows;
        },
      );
      expect(activities.length).toBe(2);
      expect(activities[1].summary).toContain("Repeat Meta Lead");

      // Verify submissions array in custom_data
      expect(leads[0].custom_data.meta_submissions).toHaveLength(1);
      expect(leads[0].custom_data.meta_submissions[0].campaign_name).toBe(
        "Marassi Resale Offers",
      );
    });
  });

  describe("6. End-to-End Webhook Payload Processing", () => {
    it("processes multi-entry webhook payloads across configured pages", async () => {
      const leadgenId3 = `leadgen_3_${uniqueSuffix}`;
      const webhookPayload: MetaWebhookPayload = {
        object: "page",
        entry: [
          {
            id: pageIdA,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: leadgenId3,
                  page_id: pageIdA,
                  form_id: "form_uptown_01",
                  ad_id: "ad_uptown_views",
                  created_time: Math.floor(Date.now() / 1000),
                },
              },
            ],
          },
        ],
      };

      const mockLeadDetails3: MetaLeadDetails = {
        id: leadgenId3,
        campaign_id: "cmp_uptown_cairo",
        campaign_name: "Uptown Cairo Golf Residences",
        form_name: "Uptown Golf Form",
        field_data: [
          { name: "full_name", values: ["يوسف الشريف"] },
          {
            name: "phone_number",
            values: [`+2010554433${uniqueSuffix.slice(0, 2)}`],
          },
          { name: "email", values: ["youssef@uptown.local"] },
        ],
      };

      const results = await processMetaWebhookPayload(webhookPayload, {
        mockLeadDetailsMap: {
          [leadgenId3]: mockLeadDetails3,
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe("CREATED");
      expect(results[0].leadgenId).toBe(leadgenId3);
    });
  });

  describe("7. Multi-Tenant Isolation Verification (Zero Leak Invariant)", () => {
    it("strictly isolates Meta integrations and webhook events between Org A and Org B", async () => {
      // Org B queries meta_integrations
      const orgBIntegrations = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM meta_integrations");
          return res.rows;
        },
      );
      expect(orgBIntegrations).toHaveLength(0);

      // Org B queries webhook_events
      const orgBWebhookEvents = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM webhook_events");
          return res.rows;
        },
      );
      expect(orgBWebhookEvents).toHaveLength(0);

      // Org B attempting to ingest with Org A's pageId fails
      await expect(
        ingestMetaLead(orgBContext, {
          pageId: pageIdA,
          leadgenId: "leadgen_unauthorized_999",
        }),
      ).rejects.toThrow(/No active Meta integration found/);
    });
  });
});
