import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  createDeal,
  createLead,
  createOpportunity,
  createOrganization,
  ForbiddenError,
  inviteMember,
  listDeals,
  listOpportunities,
  registerUser,
  updateOpportunityStage,
} from "../packages/core/src/index.js";

describe("R1.3 Opportunity domain boundary", () => {
  it("keeps salesperson ownership isolated while preserving legacy Deal aliases", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r13.owner.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1.3 Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1.3 Opportunity Org ${suffix}`,
      slug: `r13-opportunity-${suffix}`,
    });
    const ownerContext: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r13-owner-${suffix}`,
    };

    const salespersonA = await inviteMember(ownerContext, {
      email: `r13.sales.a.${suffix}@example.test`,
      fullName: "Salesperson A",
      role: "SALESPERSON",
    });
    const salespersonB = await inviteMember(ownerContext, {
      email: `r13.sales.b.${suffix}@example.test`,
      fullName: "Salesperson B",
      role: "SALESPERSON",
    });

    const salespersonAContext: TenantContext = {
      organizationId: organization.id,
      userId: salespersonA.userId,
      role: "SALESPERSON",
      correlationId: `r13-sales-a-${suffix}`,
    };
    const salespersonBContext: TenantContext = {
      organizationId: organization.id,
      userId: salespersonB.userId,
      role: "SALESPERSON",
      correlationId: `r13-sales-b-${suffix}`,
    };

    const lead = await createLead(ownerContext, {
      fullName: "Opportunity Customer",
      phone: `559${suffix}`,
      assignedUserId: salespersonA.userId,
    });

    const opportunity = await createOpportunity(salespersonAContext, {
      leadId: lead.id,
      title: "Primary property opportunity",
      value: 2500000,
      currency: "EGP",
    });

    expect(opportunity.lead_id).toBe(lead.id);
    expect(opportunity.assigned_user_id).toBe(salespersonA.userId);
    expect(opportunity.stage).toBe("DISCOVERY");

    const ownList = await listOpportunities(salespersonAContext);
    expect(ownList.map((row) => row.id)).toContain(opportunity.id);

    const foreignList = await listOpportunities(salespersonBContext);
    expect(foreignList).toHaveLength(0);

    await expect(
      updateOpportunityStage(
        salespersonBContext,
        opportunity.id,
        "NEGOTIATION",
      ),
    ).rejects.toThrow(ForbiddenError);

    const updated = await updateOpportunityStage(
      salespersonAContext,
      opportunity.id,
      "NEGOTIATION",
    );
    expect(updated.stage).toBe("NEGOTIATION");

    await expect(
      createOpportunity(salespersonBContext, {
        leadId: lead.id,
        title: "Foreign lead opportunity",
        value: 1000000,
        currency: "EGP",
      }),
    ).rejects.toThrow(ForbiddenError);

    // Legacy CRM Deal API remains a compatibility alias to the same Sales
    // Opportunity implementation while callers migrate incrementally.
    const legacyDeal = await createDeal(ownerContext, {
      leadId: lead.id,
      title: "Legacy API compatibility",
      value: 3000000,
      currency: "EGP",
    });
    expect(legacyDeal.id).toBeDefined();

    const legacyList = await listDeals(ownerContext);
    expect(legacyList.map((row) => row.id)).toContain(opportunity.id);
    expect(legacyList.map((row) => row.id)).toContain(legacyDeal.id);
  });
});
