import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import { registerUser } from "../packages/core/src/auth/auth-service.js";
import { createOrganization } from "../packages/core/src/auth/index.js";
import { inviteMember } from "../packages/core/src/permissions/member-service.js";
import { ForbiddenError } from "../packages/core/src/permissions/types.js";
import {
  parseConfigurationIntent,
  applyChangeProposal,
} from "../packages/core/src/ai/ai-builder-service.js";
import { listCustomFieldDefinitions } from "../packages/core/src/metadata/custom-fields-service.js";
import { listRules } from "../packages/core/src/rules/rules-service.js";
import { listSavedViews } from "../packages/core/src/views/views-service.js";

describe("Phase 16: AI Builder (Safe AI-Powered Configuration Assistant)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");

  let orgAContext: TenantContext;
  let orgBContext: TenantContext;
  let salesRepContext: TenantContext;

  beforeAll(async () => {
    // 1. Setup Org A (Palm Hills)
    const ownerA = await registerUser({
      email: `owner.palmhills.${uniqueSuffix}@palmhills.eg`,
      password: "StrongPassword2026!",
      fullName: "Yasseen Mansour",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Palm Hills Developments ${uniqueSuffix}`,
      slug: `palm-hills-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `ai-builder-org-a-${uniqueSuffix}`,
    };

    // Invite a salesperson in Org A
    const salesRep = await inviteMember(orgAContext, {
      email: `sales.karim.${uniqueSuffix}@palmhills.eg`,
      fullName: "كريم محمود",
      role: "SALESPERSON",
    });
    salesRepContext = {
      userId: salesRep.userId,
      organizationId: orgA.id,
      role: "SALESPERSON",
      correlationId: `ai-builder-sales-${uniqueSuffix}`,
    };

    // 2. Setup Org B (SODIC)
    const ownerB = await registerUser({
      email: `owner.sodic.${uniqueSuffix}@sodic.eg`,
      password: "StrongPassword2026!",
      fullName: "Magdy Rasekh",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `SODIC Real Estate ${uniqueSuffix}`,
      slug: `sodic-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `ai-builder-org-b-${uniqueSuffix}`,
    };
  });

  describe("1. Natural Language Intent Parsing & Change Proposals", () => {
    it("should parse custom field intent into a structured ChangeProposal", () => {
      const prompt =
        "أضف حقل مخصص في بيانات الليد اسمه طريقة السداد نوعه اختيار متعدد";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      expect(proposal.id).toBeDefined();
      expect(proposal.intentType).toBe("CREATE_CUSTOM_FIELD");
      expect(proposal.status).toBe("PENDING_APPROVAL");
      expect(proposal.title).toContain("طريقة السداد");
      expect(proposal.proposedPayload.entityType).toBe("lead");
      expect(proposal.proposedPayload.fieldType).toBe("MULTI_SELECT");
      expect(proposal.previewDiff.entity).toBe("custom_field_definitions");
      expect(proposal.previewDiff.action).toBe("INSERT");
    });

    it("should parse smart automation rule intent into a ChangeProposal", () => {
      const prompt =
        "اعمل قاعدة أتمتة اسمها توزيع الليدات بالتناوب توزع الليدات تلقائيا";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      expect(proposal.id).toBeDefined();
      expect(proposal.intentType).toBe("CREATE_SMART_RULE");
      expect(proposal.status).toBe("PENDING_APPROVAL");
      expect(proposal.title).toContain("توزيع الليدات بالتناوب");
      expect(proposal.proposedPayload.name).toBe("توزيع الليدات بالتناوب");
      expect(proposal.proposedPayload.trigger_type).toBe("lead.created");
      expect(proposal.previewDiff.entity).toBe("automation_rules");
    });

    it("should parse saved view intent into a ChangeProposal", () => {
      const prompt = "احفظ جدول عرض مخصص اسمه ليدات المعادي";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      expect(proposal.id).toBeDefined();
      expect(proposal.intentType).toBe("CREATE_SAVED_VIEW");
      expect(proposal.status).toBe("PENDING_APPROVAL");
      expect(proposal.title).toContain("ليدات المعادي");
      expect(proposal.proposedPayload.name).toBe("ليدات المعادي");
      expect(proposal.proposedPayload.entity_type).toBe("leads");
      expect(proposal.previewDiff.entity).toBe("saved_views");
    });
  });

  describe("2. Safe Proposal Application & Database Execution", () => {
    it("should apply custom field proposal and save definition without dynamic DDL", async () => {
      const prompt = "أضف حقل مخصص في بيانات الليد اسمه نوع التشطيب نوعه قائمة";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      const result = await applyChangeProposal(orgAContext, proposal);

      expect(result.applied).toBe(true);
      expect(result.resourceType).toBe("custom_field_definition");
      expect(result.resourceId).toBeDefined();
      expect(proposal.status).toBe("APPLIED");

      // Verify custom field exists in database for Org A
      const fields = await listCustomFieldDefinitions(orgAContext, "lead");
      const found = fields.find((f) => f.display_name === "نوع التشطيب");
      expect(found).toBeDefined();
      expect(found?.field_type).toBe("SINGLE_SELECT");
    });

    it("should apply smart rule proposal and persist automation rule", async () => {
      const prompt = "اعمل قاعدة أتمتة اسمها توزيع الليدات فورا";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      const result = await applyChangeProposal(orgAContext, proposal);

      expect(result.applied).toBe(true);
      expect(result.resourceType).toBe("automation_rule");
      expect(result.resourceId).toBeDefined();
      expect(proposal.status).toBe("APPLIED");

      // Verify rule exists in database for Org A
      const rules = await listRules(orgAContext);
      const found = rules.find((r) => r.name === "توزيع الليدات فورا");
      expect(found).toBeDefined();
      expect(found?.trigger_type).toBe("lead.created");
    });

    it("should apply saved view proposal and persist view", async () => {
      const prompt = "احفظ جدول عرض اسمه عرض الليدات المميزة";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      const result = await applyChangeProposal(orgAContext, proposal);

      expect(result.applied).toBe(true);
      expect(result.resourceType).toBe("saved_view");
      expect(result.resourceId).toBeDefined();
      expect(proposal.status).toBe("APPLIED");

      // Verify saved view exists in database for Org A
      const views = await listSavedViews(orgAContext, "leads");
      const found = views.find((v) => v.name === "عرض الليدات المميزة");
      expect(found).toBeDefined();
    });

    it("should reject applying an already applied proposal", async () => {
      const prompt = "أضف حقل مخصص اسمه رقم الهاتف البديل";
      const proposal = parseConfigurationIntent(orgAContext, prompt);

      await applyChangeProposal(orgAContext, proposal);
      expect(proposal.status).toBe("APPLIED");

      await expect(applyChangeProposal(orgAContext, proposal)).rejects.toThrow(
        /cannot be applied because its status is 'APPLIED'/,
      );
    });
  });

  describe("3. Permission & Tenant Isolation Verification", () => {
    it("should forbid non-admin roles (SALESPERSON) from creating custom fields or rules via AI Builder", async () => {
      const customFieldProposal = parseConfigurationIntent(
        salesRepContext,
        "أضف حقل مخصص اسمه حقل ممنوع",
      );

      await expect(
        applyChangeProposal(salesRepContext, customFieldProposal),
      ).rejects.toThrow(ForbiddenError);

      const ruleProposal = parseConfigurationIntent(
        salesRepContext,
        "اعمل قاعدة أتمتة اسمها قاعدة غير مصرح بها",
      );

      await expect(
        applyChangeProposal(salesRepContext, ruleProposal),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should enforce zero tenant leak: Org B cannot see custom fields, rules, or views created by Org A", async () => {
      // Check Org B custom fields
      const orgBFields = await listCustomFieldDefinitions(orgBContext, "lead");
      const leakedField = orgBFields.find(
        (f) => f.display_name === "نوع التشطيب",
      );
      expect(leakedField).toBeUndefined();

      // Check Org B smart rules
      const orgBRules = await listRules(orgBContext);
      const leakedRule = orgBRules.find((r) => r.name === "توزيع الليدات فورا");
      expect(leakedRule).toBeUndefined();

      // Check Org B saved views
      const orgBViews = await listSavedViews(orgBContext, "leads");
      const leakedView = orgBViews.find(
        (v) => v.name === "عرض الليدات المميزة",
      );
      expect(leakedView).toBeUndefined();
    });
  });
});
