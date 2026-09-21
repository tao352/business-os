import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import { registerUser } from "../packages/core/src/auth/auth-service.js";
import { createOrganization } from "../packages/core/src/auth/index.js";
import { inviteMember } from "../packages/core/src/permissions/member-service.js";
import { createLead } from "../packages/core/src/crm/lead-service.js";
import { createProject } from "../packages/core/src/real-estate/project-service.js";
import { createUnit } from "../packages/core/src/real-estate/unit-service.js";
import { createContract } from "../packages/core/src/real-estate/contract-service.js";
import {
  ingestKnowledgeDocument,
  DeterministicEmbeddingProvider,
  validateSafeReadOnlySql,
  assertSafeReadOnlySql,
  SqlSafetyViolationError,
  askBusiness,
} from "../packages/core/src/ai/index.js";

describe("Phase 15: Ask Your Business (Text-to-SQL & Hybrid AI Assistant)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  const embeddingProvider = new DeterministicEmbeddingProvider();

  let orgAContext: TenantContext;
  let orgBContext: TenantContext;
  let repAId: string;

  beforeAll(async () => {
    // 1. Setup Org A (Emaar Misr)
    const ownerA = await registerUser({
      email: `owner.emaar.${uniqueSuffix}@emaar.eg`,
      password: "StrongPassword2026!",
      fullName: "Mohamed Alabbar",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Emaar Misr ${uniqueSuffix}`,
      slug: `emaar-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `ask-biz-org-a-${uniqueSuffix}`,
    };

    const repA = await inviteMember(orgAContext, {
      email: `rep.sherif.${uniqueSuffix}@emaar.eg`,
      fullName: "شريف فوزي",
      role: "SALESPERSON",
    });
    repAId = repA.userId;

    // 2. Setup Org B (Orascom)
    const ownerB = await registerUser({
      email: `owner.orascom.${uniqueSuffix}@orascom.eg`,
      password: "StrongPassword2026!",
      fullName: "Samih Sawiris",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Orascom Developments ${uniqueSuffix}`,
      slug: `orascom-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `ask-biz-org-b-${uniqueSuffix}`,
    };

    // 3. Seed Org A Data
    const project = await createProject(orgAContext, {
      name: `Uptown Cairo ${uniqueSuffix}`,
      location: "Mokattam, Cairo",
    });

    // Units
    const villa1 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "Villa-Uptown-10",
      unitType: "STANDALONE_VILLA",
      price: 22000000,
      grossArea: 380,
    });

    await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "Villa-Uptown-11",
      unitType: "STANDALONE_VILLA",
      price: 35000000,
      grossArea: 500,
    });

    const apt1 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "Apt-Uptown-201",
      unitType: "APARTMENT",
      price: 8500000,
      grossArea: 160,
    });

    // Contract for Villa 1 with Rep Sherif
    const lead1 = await createLead(orgAContext, {
      fullName: "عمرو دياب",
      phone: `+2010123456${uniqueSuffix.slice(0, 2)}`,
      assignedUserId: repAId,
    });

    await createContract(orgAContext, {
      leadId: lead1.id,
      unitId: villa1.id,
      contractNumber: `CTR-UPTOWN-${uniqueSuffix}`,
      contractValue: 22000000,
      status: "SIGNED",
    });

    // Ingest Knowledge Document in Org A
    await ingestKnowledgeDocument(
      orgAContext,
      {
        title: "سياسة السداد والتشطيب في أب تاون كايرو",
        sourceType: "POLICY",
        content:
          "نظام سداد أب تاون كايرو: 5% دفعة تعاقد، والباقي تقسيط على 8 سنوات مع تشطيب كامل بالتكييفات والتسليم خلال 24 شهر.",
      },
      embeddingProvider,
    );
  });

  describe("1. SQL Safety Guard", () => {
    it("blocks dangerous mutating statements and SQL injection attempts", () => {
      const dropCheck = validateSafeReadOnlySql("DROP TABLE leads");
      expect(dropCheck.safe).toBe(false);
      expect(dropCheck.error).toContain("DROP");

      const updateCheck = validateSafeReadOnlySql(
        "UPDATE users SET role = 'OWNER'",
      );
      expect(updateCheck.safe).toBe(false);
      expect(updateCheck.error).toContain("UPDATE");

      const chainedCheck = validateSafeReadOnlySql(
        "SELECT * FROM leads; DELETE FROM users",
      );
      expect(chainedCheck.safe).toBe(false);
      expect(chainedCheck.error).toContain("semicolons");

      const systemCatalogCheck = validateSafeReadOnlySql(
        "SELECT * FROM pg_catalog.pg_tables",
      );
      expect(systemCatalogCheck.safe).toBe(false);
      expect(systemCatalogCheck.error).toContain("PG_");

      expect(() => assertSafeReadOnlySql("TRUNCATE TABLE contracts")).toThrow(
        SqlSafetyViolationError,
      );
    });

    it("allows valid single-statement read-only queries", () => {
      const safeCheck = validateSafeReadOnlySql(
        "SELECT id, price FROM units WHERE price > 1000000",
      );
      expect(safeCheck.safe).toBe(true);
    });
  });

  describe("2. Text-to-SQL Relational Queries", () => {
    it("answers unit availability question with price filtering in Arabic", async () => {
      // Question asks for available villas under 25 million
      const res = await askBusiness(
        orgAContext,
        { question: "كم فيلا متاحة في المشروع أقل من 25 مليون؟" },
        embeddingProvider,
      );

      expect(res.intentType).toBe("RELATIONAL_QUERY");
      expect(res.sqlQuery).toBeDefined();
      expect(res.data).toBeDefined();
      // Villa-10 was contracted, Villa-11 is 35M, so 0 villas under 25M available
      expect(res.data?.length).toBe(0);
      expect(res.answerText).toContain("لا توجد وحدات متاحة");
    });

    it("answers question for available apartments", async () => {
      const res = await askBusiness(
        orgAContext,
        { question: "ما هي الشقق المتاحة؟" },
        embeddingProvider,
      );

      expect(res.intentType).toBe("RELATIONAL_QUERY");
      expect(res.data?.length).toBe(1);
      expect(res.data?.[0]?.["unit_number"]).toBe("Apt-Uptown-201");
      expect(res.answerText).toContain("1 وحدة متاحة");
    });

    it("identifies top salesperson from signed contracts", async () => {
      const res = await askBusiness(
        orgAContext,
        { question: "مين أفضل سيلز؟" },
        embeddingProvider,
      );

      expect(res.intentType).toBe("RELATIONAL_QUERY");
      expect(res.data?.length).toBe(1);
      expect(res.data?.[0]?.["full_name"]).toBe("شريف فوزي");
      expect(Number(res.data?.[0]?.["total_revenue"])).toBe(22000000);
      expect(res.answerText).toContain("شريف فوزي");
    });
  });

  describe("3. Semantic Knowledge Q&A", () => {
    it("answers payment policy question using vector knowledge retrieval", async () => {
      const res = await askBusiness(
        orgAContext,
        { question: "ما هو نظام السداد والأقساط وفترة الاستلام؟" },
        embeddingProvider,
      );

      expect(res.knowledgeMatches).toBeDefined();
      expect(res.knowledgeMatches?.length).toBeGreaterThan(0);
      expect(res.answerText).toContain("5% دفعة تعاقد");
    });
  });

  describe("4. Multi-Tenant Isolation (Zero Leak Invariant)", () => {
    it("ensures Org B asking identical questions receives ZERO results from Org A", async () => {
      // Org B asks for available apartments
      const resBUnits = await askBusiness(
        orgBContext,
        { question: "ما هي الشقق المتاحة؟" },
        embeddingProvider,
      );

      expect(resBUnits.data?.length).toBe(0);
      expect(resBUnits.answerText).toContain("لا توجد وحدات متاحة");

      // Org B asks for payment policies
      const resBPolicy = await askBusiness(
        orgBContext,
        { question: "ما هو نظام السداد والأقساط وفترة الاستلام؟" },
        embeddingProvider,
      );

      expect(resBPolicy.knowledgeMatches?.length).toBe(0);
      expect(resBPolicy.answerText).toContain("لم أتمكن من العثور");
    });
  });
});
