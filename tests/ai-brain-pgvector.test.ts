import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import { registerUser } from "../packages/core/src/auth/auth-service.js";
import { createOrganization } from "../packages/core/src/auth/index.js";
import { inviteMember } from "../packages/core/src/permissions/member-service.js";
import { createLead } from "../packages/core/src/crm/lead-service.js";
import { createProject } from "../packages/core/src/real-estate/project-service.js";
import { createUnit } from "../packages/core/src/real-estate/unit-service.js";
import {
  chunkText,
  DeterministicEmbeddingProvider,
  ingestKnowledgeDocument,
  searchSimilarKnowledge,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  retrieveGroundedContext,
} from "../packages/core/src/ai/index.js";

describe("Phase 13: AI Brain & Vector Knowledge Engine (pgvector RAG)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  const embeddingProvider = new DeterministicEmbeddingProvider();

  let orgAContext: TenantContext;
  let orgBContext: TenantContext;
  let salespersonAContext: TenantContext;

  let docPaymentId: string;
  let docVillaId: string;
  let docSecretId: string;

  let leadAId: string;
  let unitAId: string;

  beforeAll(async () => {
    // 1. Setup Org A (Palm Hills Developments)
    const ownerA = await registerUser({
      email: `owner.palmhills.${uniqueSuffix}@palmhills.local`,
      password: "StrongPassword2026!",
      fullName: "Yasseen Mansour",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Palm Hills Developments ${uniqueSuffix}`,
      slug: `palmhills-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `ai-test-org-a-${uniqueSuffix}`,
    };

    // Add Salesperson in Org A
    const salesA = await inviteMember(orgAContext, {
      email: `sales.${uniqueSuffix}@palmhills.local`,
      fullName: "Ahmed Sales Agent",
      role: "SALESPERSON",
    });
    salespersonAContext = {
      userId: salesA.userId,
      organizationId: orgA.id,
      role: "SALESPERSON",
      correlationId: `ai-test-sales-a-${uniqueSuffix}`,
    };

    // 3. Setup Org B (Emaar Misr)
    const ownerB = await registerUser({
      email: `owner.emaar.${uniqueSuffix}@emaar.local`,
      password: "StrongPassword2026!",
      fullName: "Mohamed Alabbar",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Emaar Misr ${uniqueSuffix}`,
      slug: `emaar-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `ai-test-org-b-${uniqueSuffix}`,
    };

    // 4. Seed operational CRM entities in Org A
    const lead = await createLead(orgAContext, {
      fullName: "كريم الشناوي",
      phone: `+2010998877${uniqueSuffix.slice(0, 2)}`,
      email: `karim.${uniqueSuffix}@client.eg`,
    });
    leadAId = lead.id;

    const project = await createProject(orgAContext, {
      name: `Badya Palm Hills ${uniqueSuffix}`,
      location: "6th of October City, Giza",
    });

    const unit = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "V-Badya-104",
      unitType: "VILLA",
      price: 18500000,
      grossArea: 380,
    });
    unitAId = unit.id;
  });

  describe("1. Document Chunking Service", () => {
    it("splits long text into overlapping sliding-window chunks with boundary awareness", () => {
      const sampleText = `
Paragraph 1: Welcome to Palm Hills luxury developments in West Cairo. Our flagship project Badya offers smart city living.

Paragraph 2: Flexible payment plans start with a 10% reservation down payment. Installments are distributed across 8 consecutive years.

Paragraph 3: Handover and delivery starts 3 years from the date of contract execution with full landscaping.
      `.trim();

      const chunks = chunkText(sampleText, {
        chunkSize: 120,
        chunkOverlap: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
      }
      expect(chunks[0]).toContain("Paragraph 1");
    });

    it("returns a single chunk when text is shorter than chunkSize", () => {
      const shortText = "Palm Hills customer service hotline is 19777.";
      const chunks = chunkText(shortText, { chunkSize: 200 });
      expect(chunks).toEqual([shortText]);
    });

    it("handles empty string gracefully", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   ")).toEqual([]);
    });
  });

  describe("2. Vector Embedding Provider", () => {
    it("generates normalized 1536-dimensional vectors with high similarity for semantic matches", async () => {
      const vec1 = await embeddingProvider.generateEmbedding(
        "Flexible 8 years installment payment plan for Palm Hills villa",
      );
      const vec2 = await embeddingProvider.generateEmbedding(
        "Palm Hills payment plan installments over 8 years",
      );
      const vecUnrelated = await embeddingProvider.generateEmbedding(
        "Deep sea marine biology hydrothermal vents",
      );

      expect(vec1.length).toBe(1536);
      expect(vec2.length).toBe(1536);
      expect(vecUnrelated.length).toBe(1536);

      // Verify L2 norm is ~1.0
      const norm1 = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
      expect(norm1).toBeCloseTo(1.0, 4);

      // Cosine similarity between similar texts should be high
      let simSimilar = 0;
      for (let i = 0; i < 1536; i++) {
        simSimilar += (vec1[i] ?? 0) * (vec2[i] ?? 0);
      }
      expect(simSimilar).toBeGreaterThan(0.6);

      // Cosine similarity between unrelated texts should be low
      let simUnrelated = 0;
      for (let i = 0; i < 1536; i++) {
        simUnrelated += (vec1[i] ?? 0) * (vecUnrelated[i] ?? 0);
      }
      expect(simUnrelated).toBeLessThan(0.4);
    });
  });

  describe("3. Document Ingestion & pgvector Storage", () => {
    it("ingests policy document and creates chunks with vector embeddings in PostgreSQL", async () => {
      const result = await ingestKnowledgeDocument(
        orgAContext,
        {
          title: "سياسة السداد والأقساط بمشروع بادية",
          sourceType: "POLICY",
          content:
            "نظام السداد في مشروع بادية بالم هيلز: مقدم حجز 10%، وتقسيط الباقي على أقساط متساوية لمدة 8 سنوات بدون فوائد. موعد الاستلام خلال 3 سنوات.",
          metadata: { project: "Badya", category: "Finance" },
          chunkSize: 100,
          chunkOverlap: 20,
        },
        embeddingProvider,
      );

      docPaymentId = result.document.id;
      expect(result.document.title).toBe("سياسة السداد والأقساط بمشروع بادية");
      expect(result.chunksCount).toBeGreaterThan(0);

      // Verify records in DB
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        const docRes = await tx.query(
          "SELECT * FROM knowledge_documents WHERE id = $1",
          [docPaymentId],
        );
        expect(docRes.rows.length).toBe(1);

        const chunksRes = await tx.query(
          "SELECT * FROM document_chunks WHERE document_id = $1",
          [docPaymentId],
        );
        expect(chunksRes.rows.length).toBe(result.chunksCount);
        expect(chunksRes.rows[0].embedding).toBeDefined();
      });
    });

    it("ingests brochure document for villa units", async () => {
      const result = await ingestKnowledgeDocument(
        orgAContext,
        {
          title: "مواصفات فيلات بادية بالم هيلز",
          sourceType: "BROCHURE",
          content:
            "فيلا مستقلة نموذج V-Badya: تتكون من 4 غرف نوم رئيسية، 5 حمامات، حديقة خاصة بمساحة 380 متر مربع، وسعر يبدأ من 18 مليون و500 ألف جنيه مصري.",
          metadata: { project: "Badya", unitType: "VILLA" },
          chunkSize: 120,
        },
        embeddingProvider,
      );

      docVillaId = result.document.id;
      expect(result.chunksCount).toBeGreaterThan(0);
    });

    it("ingests confidential internal document in Org A for security testing", async () => {
      const result = await ingestKnowledgeDocument(
        orgAContext,
        {
          title: "Palm Hills Confidential Executive Bonuses 2026",
          sourceType: "POLICY",
          content:
            "Secret executive bonus allocations for Palm Hills leadership committee: 50,000,000 EGP total pool.",
          metadata: { classification: "TOP_SECRET" },
        },
        embeddingProvider,
      );
      docSecretId = result.document.id;
      expect(docSecretId).toBeDefined();
    });
  });

  describe("4. Vector Cosine Similarity Search", () => {
    it("ranks relevant knowledge chunks highest using pgvector cosine distance (<=>)", async () => {
      const searchResults = await searchSimilarKnowledge(
        orgAContext,
        {
          query: "نظام التقسيط والمقدم في بادية كم سنة",
          limit: 3,
        },
        embeddingProvider,
      );

      expect(searchResults.length).toBeGreaterThan(0);
      const topMatch = searchResults[0]!;
      expect(topMatch.documentId).toBe(docPaymentId);
      expect(topMatch.content).toContain("أقساط متساوية لمدة 8 سنوات");
      expect(topMatch.similarity).toBeGreaterThan(0.2);
    });

    it("filters search results by source_type when requested", async () => {
      const brochureResults = await searchSimilarKnowledge(
        orgAContext,
        {
          query: "فيلا غرف نوم وحديقة خاصة",
          filterSourceType: "BROCHURE",
          limit: 3,
        },
        embeddingProvider,
      );

      expect(brochureResults.length).toBeGreaterThan(0);
      expect(brochureResults[0]!.sourceType).toBe("BROCHURE");
      expect(brochureResults[0]!.documentId).toBe(docVillaId);
    });

    it("allows SALESPERSON role to read knowledge base", async () => {
      const results = await searchSimilarKnowledge(
        salespersonAContext,
        {
          query: "مواصفات فيلا بادية",
          limit: 2,
        },
        embeddingProvider,
      );

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("5. Hybrid Context Retriever (pgvector + Operational CRM)", () => {
    it("retrieves semantic knowledge along with live Lead and Unit CRM entity data", async () => {
      const hybridContext = await retrieveGroundedContext(
        orgAContext,
        "ما هي أنظمة السداد المتاحة لمقدم الحجز؟",
        {
          leadId: leadAId,
          unitId: unitAId,
          limit: 3,
          embeddingProvider,
        },
      );

      expect(hybridContext.query).toBe(
        "ما هي أنظمة السداد المتاحة لمقدم الحجز؟",
      );
      expect(hybridContext.knowledgeMatches.length).toBeGreaterThan(0);
      expect(hybridContext.knowledgeMatches[0]!.documentId).toBe(docPaymentId);

      // Verify live CRM Lead context
      expect(hybridContext.crmContext?.lead).toBeDefined();
      expect(hybridContext.crmContext?.lead?.full_name).toBe("كريم الشناوي");

      // Verify live CRM Unit context with joined project details
      expect(hybridContext.crmContext?.unit).toBeDefined();
      expect(hybridContext.crmContext?.unit?.unit_number).toBe("V-Badya-104");
      expect(Number(hybridContext.crmContext?.unit?.price)).toBe(18500000);
      expect(hybridContext.crmContext?.unit?.project_name).toContain(
        "Badya Palm Hills",
      );
    });
  });

  describe("6. Multi-Tenant Isolation Invariant (Zero Leak Tolerance)", () => {
    it("ensures Org B searching for identical terms returns ZERO results from Org A", async () => {
      // Org B searches for Org A's confidential document
      const orgBResults = await searchSimilarKnowledge(
        orgBContext,
        {
          query: "Palm Hills Confidential Executive Bonuses 2026 pool",
          limit: 10,
        },
        embeddingProvider,
      );

      // Must be 0 because Org B has no documents
      expect(orgBResults.length).toBe(0);

      // Direct SQL isolation check inside Org B tenant session
      await withTenantContext(orgBContext.organizationId, async (tx) => {
        const leakedDocs = await tx.query("SELECT * FROM knowledge_documents");
        expect(leakedDocs.rows.length).toBe(0);

        const leakedChunks = await tx.query("SELECT * FROM document_chunks");
        expect(leakedChunks.rows.length).toBe(0);
      });
    });

    it("ensures Org B cannot retrieve Org A entities via Hybrid Retriever", async () => {
      const hybridB = await retrieveGroundedContext(
        orgBContext,
        "مواصفات الفيلا",
        {
          leadId: leadAId,
          unitId: unitAId,
          embeddingProvider,
        },
      );

      expect(hybridB.knowledgeMatches.length).toBe(0);
      expect(hybridB.crmContext?.lead).toBeNull();
      expect(hybridB.crmContext?.unit).toBeNull();
    });
  });

  describe("7. Cascade Deletion & Audit Trail", () => {
    it("deletes document and cascades deletion to all associated chunks", async () => {
      const docsBefore = await listKnowledgeDocuments(orgAContext);
      expect(docsBefore.some((d) => d.id === docSecretId)).toBe(true);

      const deleted = await deleteKnowledgeDocument(orgAContext, docSecretId);
      expect(deleted).toBe(true);

      // Verify document is gone
      const docsAfter = await listKnowledgeDocuments(orgAContext);
      expect(docsAfter.some((d) => d.id === docSecretId)).toBe(false);

      // Verify chunks were cascaded in DB
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        const orphanChunks = await tx.query(
          "SELECT * FROM document_chunks WHERE document_id = $1",
          [docSecretId],
        );
        expect(orphanChunks.rows.length).toBe(0);

        // Verify audit log
        const auditRes = await tx.query(
          `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'DELETE'`,
          [docSecretId],
        );
        expect(auditRes.rows.length).toBe(1);
      });
    });
  });
});
