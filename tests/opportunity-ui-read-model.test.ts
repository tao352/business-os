import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  createLead,
  createOpportunity,
  createOrganization,
  getOpportunityWorkspace,
  getUiCapabilities,
  inviteMember,
  listOpportunitiesPage,
  registerUser,
  updateOpportunityStage,
} from "../packages/core/src/index.js";

describe("Opportunity UI read models", () => {
  it("paginates, searches, filters, and preserves salesperson ownership scoping", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `opui.owner.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "Opportunity UI Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `Opportunity UI Org ${suffix}`,
      slug: `opui-${suffix}`,
    });
    const ownerContext: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `opui-owner-${suffix}`,
    };

    const salespersonA = await inviteMember(ownerContext, {
      email: `opui.sales.a.${suffix}@example.test`,
      fullName: "Opportunity UI Sales A",
      role: "SALESPERSON",
    });
    const salespersonB = await inviteMember(ownerContext, {
      email: `opui.sales.b.${suffix}@example.test`,
      fullName: "Opportunity UI Sales B",
      role: "SALESPERSON",
    });

    const contextA: TenantContext = {
      organizationId: organization.id,
      userId: salespersonA.userId,
      role: "SALESPERSON",
      correlationId: `opui-a-${suffix}`,
    };
    const contextB: TenantContext = {
      organizationId: organization.id,
      userId: salespersonB.userId,
      role: "SALESPERSON",
      correlationId: `opui-b-${suffix}`,
    };

    const leadA = await createLead(ownerContext, {
      fullName: "Ahmed Opportunity Search",
      phone: `580${suffix}`,
      assignedUserId: salespersonA.userId,
    });
    const leadB = await createLead(ownerContext, {
      fullName: "Mona Separate Customer",
      phone: `581${suffix}`,
      assignedUserId: salespersonB.userId,
    });

    const opportunityA1 = await createOpportunity(contextA, {
      leadId: leadA.id,
      title: "Al Safwa Apartment",
      value: 2_200_000,
      currency: "EGP",
    });
    const opportunityA2 = await createOpportunity(contextA, {
      leadId: leadA.id,
      title: "Stars Mall Office",
      value: 1_500_000,
      currency: "EGP",
    });
    await updateOpportunityStage(
      contextA,
      opportunityA2.id,
      "NEGOTIATION",
    );

    const opportunityB = await createOpportunity(contextB, {
      leadId: leadB.id,
      title: "Tenant-visible only to Sales B",
      value: 900_000,
      currency: "EGP",
    });

    const salespersonPage = await listOpportunitiesPage(contextA, {
      page: 1,
      pageSize: 10,
    });
    expect(salespersonPage.totalCount).toBe(2);
    expect(salespersonPage.opportunities.map((row) => row.id)).toContain(
      opportunityA1.id,
    );
    expect(salespersonPage.opportunities.map((row) => row.id)).toContain(
      opportunityA2.id,
    );
    expect(salespersonPage.opportunities.map((row) => row.id)).not.toContain(
      opportunityB.id,
    );

    const searched = await listOpportunitiesPage(ownerContext, {
      search: "Ahmed Opportunity",
      page: 1,
      pageSize: 1,
    });
    expect(searched.totalCount).toBe(2);
    expect(searched.opportunities).toHaveLength(1);

    const negotiation = await listOpportunitiesPage(ownerContext, {
      stage: "NEGOTIATION",
      page: 1,
      pageSize: 20,
    });
    expect(negotiation.totalCount).toBe(1);
    expect(negotiation.opportunities[0]?.id).toBe(opportunityA2.id);
  });

  it("loads immutable stage history and rejects cross-tenant workspace access", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const ownerA = await registerUser({
      email: `opui.a.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "Opportunity UI Tenant A",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Opportunity UI A ${suffix}`,
      slug: `opui-a-${suffix}`,
    });
    const contextA: TenantContext = {
      organizationId: orgA.id,
      userId: ownerA.id,
      role: "OWNER",
      correlationId: `opui-a-${suffix}`,
    };

    const lead = await createLead(contextA, {
      fullName: "Opportunity Workspace Customer",
      phone: `582${suffix}`,
    });
    const opportunity = await createOpportunity(contextA, {
      leadId: lead.id,
      title: "Workspace Opportunity",
      value: 3_000_000,
      currency: "EGP",
    });
    await updateOpportunityStage(contextA, opportunity.id, "PROPOSAL");

    const workspace = await getOpportunityWorkspace(contextA, opportunity.id);
    expect(workspace.opportunity.id).toBe(opportunity.id);
    expect(workspace.opportunity.lead_name).toBe(
      "Opportunity Workspace Customer",
    );
    expect(workspace.history.some((row) => row.to_stage === "DISCOVERY")).toBe(
      true,
    );
    expect(workspace.history.some((row) => row.to_stage === "PROPOSAL")).toBe(
      true,
    );

    const ownerB = await registerUser({
      email: `opui.b.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "Opportunity UI Tenant B",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Opportunity UI B ${suffix}`,
      slug: `opui-b-${suffix}`,
    });
    const contextB: TenantContext = {
      organizationId: orgB.id,
      userId: ownerB.id,
      role: "OWNER",
      correlationId: `opui-b-${suffix}`,
    };

    await expect(
      getOpportunityWorkspace(contextB, opportunity.id),
    ).rejects.toThrow("Opportunity not found");
  });

  it("exposes Opportunity navigation and mutation capabilities from the permission matrix", () => {
    const owner = getUiCapabilities({ role: "OWNER" });
    expect(owner.canReadOpportunities).toBe(true);
    expect(owner.canCreateOpportunity).toBe(true);
    expect(owner.canUpdateOpportunity).toBe(true);

    const readOnly = getUiCapabilities({ role: "READ_ONLY" });
    expect(readOnly.canReadOpportunities).toBe(true);
    expect(readOnly.canCreateOpportunity).toBe(false);
    expect(readOnly.canUpdateOpportunity).toBe(false);

    const marketing = getUiCapabilities({ role: "MARKETING_USER" });
    expect(marketing.canReadOpportunities).toBe(false);

    const finance = getUiCapabilities({ role: "FINANCE" });
    expect(finance.canReadOpportunities).toBe(false);
  });
});
