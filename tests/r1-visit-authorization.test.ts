import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  createLead,
  createOrganization,
  createProject,
  listVisits,
  registerUser,
  scheduleVisit,
  updateVisitStatus,
} from "../packages/core/src/index.js";
import { ForbiddenError } from "../packages/core/src/permissions/types.js";

describe("R1 visit authorization", () => {
  it("scopes visits to assigned Salespeople and rejects cross-tenant agents", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");

    const ownerA = await registerUser({
      email: `r1.visits.owner.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Visits Owner",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `R1 Visits Org ${suffix}`,
      slug: `r1-visits-${suffix}`,
    });
    const ownerContext: TenantContext = {
      organizationId: orgA.id,
      userId: ownerA.id,
      role: "OWNER",
      correlationId: `r1-visits-owner-${suffix}`,
    };

    const salesA = await registerUser({
      email: `r1.visits.a.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Sales A",
    });
    const salesB = await registerUser({
      email: `r1.visits.b.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Sales B",
    });

    await withTenantContext(orgA.id, async (tx) => {
      await tx.query(
        `INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          is_active
        ) VALUES ($1, $2, 'SALESPERSON', true), ($1, $3, 'SALESPERSON', true)`,
        [orgA.id, salesA.id, salesB.id],
      );
    });

    const salesAContext: TenantContext = {
      organizationId: orgA.id,
      userId: salesA.id,
      role: "SALESPERSON",
      correlationId: `r1-visits-a-${suffix}`,
    };
    const salesBContext: TenantContext = {
      organizationId: orgA.id,
      userId: salesB.id,
      role: "SALESPERSON",
      correlationId: `r1-visits-b-${suffix}`,
    };

    const project = await createProject(ownerContext, {
      name: "R1 Visit Project",
      location: "Test Location",
      projectType: "RESIDENTIAL",
      totalUnits: 0,
    });

    const leadA = await createLead(ownerContext, {
      fullName: "Visit Lead A",
      phone: `559${suffix}1`,
      assignedUserId: salesA.id,
    });
    const leadB = await createLead(ownerContext, {
      fullName: "Visit Lead B",
      phone: `559${suffix}2`,
      assignedUserId: salesB.id,
    });

    const visitA = await scheduleVisit(ownerContext, {
      leadId: leadA.id,
      projectId: project.id,
      assignedAgentId: salesA.id,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const visitB = await scheduleVisit(ownerContext, {
      leadId: leadB.id,
      projectId: project.id,
      assignedAgentId: salesB.id,
      scheduledAt: new Date(Date.now() + 172_800_000).toISOString(),
    });

    await expect(
      scheduleVisit(salesAContext, {
        leadId: leadB.id,
        projectId: project.id,
        scheduledAt: new Date(Date.now() + 259_200_000).toISOString(),
      }),
    ).rejects.toThrow(ForbiddenError);

    const visibleToA = await listVisits(salesAContext);
    expect(visibleToA.map((visit) => visit.id)).toEqual([visitA.id]);

    const visibleToB = await listVisits(salesBContext);
    expect(visibleToB.map((visit) => visit.id)).toEqual([visitB.id]);

    await expect(
      updateVisitStatus(salesAContext, visitB.id, "COMPLETED"),
    ).rejects.toThrow(ForbiddenError);

    const ownerB = await registerUser({
      email: `r1.visits.foreign.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "Foreign Tenant Owner",
    });
    await createOrganization({
      userId: ownerB.id,
      name: `Foreign Visit Org ${suffix}`,
      slug: `foreign-visits-${suffix}`,
    });

    await expect(
      scheduleVisit(ownerContext, {
        leadId: leadA.id,
        projectId: project.id,
        assignedAgentId: ownerB.id,
        scheduledAt: new Date(Date.now() + 345_600_000).toISOString(),
      }),
    ).rejects.toThrow("Cannot assign");
  });
});
