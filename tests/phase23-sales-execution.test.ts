import { describe, expect, it, beforeAll } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  inviteMember,
  createLead,
  getLead,
  updateLeadStatus,
  listLeadStageHistory,
  createTask,
  listLeadFollowUpHealth,
  logActivity,
  ForbiddenError,
} from "../packages/core/src/index.js";

describe("Phase 23A Sales Execution & Anti-Lead-Leakage", () => {
  const unique = crypto.randomBytes(4).toString("hex");

  let ownerContext: TenantContext;
  let salesAContext: TenantContext;
  let salesBContext: TenantContext;
  let salesAUserId: string;
  let salesBUserId: string;

  beforeAll(async () => {
    const owner = await registerUser({
      email: `phase23.owner.${unique}@example.test`,
      password: "Phase23Password123!",
      fullName: "Phase 23 Owner",
    });

    const organization = await createOrganization({
      userId: owner.id,
      name: `Phase 23 Test Org ${unique}`,
      slug: `phase23-${unique}`,
    });

    ownerContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `phase23-owner-${unique}`,
    };

    const salesA = await inviteMember(ownerContext, {
      email: `phase23.sales.a.${unique}@example.test`,
      fullName: "Phase 23 Sales A",
      role: "SALESPERSON",
    });
    salesAUserId = salesA.userId;
    salesAContext = {
      organizationId: organization.id,
      userId: salesAUserId,
      role: "SALESPERSON",
      correlationId: `phase23-sales-a-${unique}`,
    };

    const salesB = await inviteMember(ownerContext, {
      email: `phase23.sales.b.${unique}@example.test`,
      fullName: "Phase 23 Sales B",
      role: "SALESPERSON",
    });
    salesBUserId = salesB.userId;
    salesBContext = {
      organizationId: organization.id,
      userId: salesBUserId,
      role: "SALESPERSON",
      correlationId: `phase23-sales-b-${unique}`,
    };
  });

  it("records closure history and clears it on reactivation", async () => {
    const lead = await createLead(ownerContext, {
      fullName: "Pipeline History Lead",
      phone: "+201000000001",
      assignedUserId: salesAUserId,
      status: "NEW",
    });

    const initialHistory = await listLeadStageHistory(ownerContext, lead.id);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0]?.from_status).toBeNull();
    expect(initialHistory[0]?.to_status).toBe("NEW");

    await updateLeadStatus(salesAContext, lead.id, "CONTACTED");
    const closed = await updateLeadStatus(salesAContext, lead.id, "LOST", {
      lostReasonCode: "PRICE",
      lostReasonNotes: "Budget below current inventory.",
      metadata: { source: "phase23_test" },
    });

    expect(closed.status).toBe("LOST");
    expect(closed.lost_reason_code).toBe("PRICE");
    expect(closed.lost_reason_notes).toBe("Budget below current inventory.");
    expect(closed.closed_at).toBeTruthy();

    const closedHistory = await listLeadStageHistory(salesAContext, lead.id);
    expect(closedHistory[0]?.from_status).toBe("CONTACTED");
    expect(closedHistory[0]?.to_status).toBe("LOST");
    expect(closedHistory[0]?.reason_code).toBe("PRICE");

    const reactivated = await updateLeadStatus(
      salesAContext,
      lead.id,
      "QUALIFIED",
    );
    expect(reactivated.status).toBe("QUALIFIED");
    expect(reactivated.lost_reason_code).toBeNull();
    expect(reactivated.lost_reason_notes).toBeNull();
    expect(reactivated.closed_at).toBeNull();
  });

  it("blocks impossible manual pipeline jumps", async () => {
    const lead = await createLead(ownerContext, {
      fullName: "Invalid Jump Lead",
      phone: "+201000000002",
      assignedUserId: salesAUserId,
      status: "NEW",
    });

    await expect(
      updateLeadStatus(salesAContext, lead.id, "CONTRACTED"),
    ).rejects.toThrow(
      "Invalid lead pipeline transition from 'NEW' to 'CONTRACTED'",
    );

    const unchanged = await getLead(ownerContext, lead.id);
    expect(unchanged.status).toBe("NEW");
  });

  it("uses the earliest open task as the Lead next action", async () => {
    const lead = await createLead(ownerContext, {
      fullName: "Follow Up Health Lead",
      phone: "+201000000003",
      assignedUserId: salesAUserId,
      status: "NEW",
    });

    const noActionRows = await listLeadFollowUpHealth(salesAContext);
    const noAction = noActionRows.find((row) => row.leadId === lead.id);
    expect(noAction?.health).toBe("NO_NEXT_ACTION");
    expect(noAction?.nextActionId).toBeNull();

    const overdueTask = await createTask(salesAContext, {
      leadId: lead.id,
      assignedUserId: salesAUserId,
      title: "Call overdue lead",
      dueDate: new Date(Date.now() - 60_000).toISOString(),
      priority: "HIGH",
    });

    const overdueRows = await listLeadFollowUpHealth(salesAContext);
    const overdue = overdueRows.find((row) => row.leadId === lead.id);
    expect(overdue?.health).toBe("OVERDUE_NEXT_ACTION");
    expect(overdue?.nextActionId).toBe(overdueTask.id);
    expect(overdue?.nextActionTitle).toBe("Call overdue lead");
  });

  it("keeps internal notes from faking customer contact", async () => {
    const lead = await createLead(ownerContext, {
      fullName: "Contact Timestamp Lead",
      phone: "+201000000006",
      assignedUserId: salesAUserId,
      status: "NEW",
    });

    await logActivity(salesAContext, {
      leadId: lead.id,
      activityType: "NOTE",
      summary: "Internal note only",
    });
    const afterNote = await getLead(salesAContext, lead.id);
    expect(afterNote.last_contacted_at).toBeNull();

    await logActivity(salesAContext, {
      leadId: lead.id,
      activityType: "CALL",
      summary: "Customer contacted by phone",
    });
    const afterCall = await getLead(salesAContext, lead.id);
    expect(afterCall.last_contacted_at).toBeTruthy();
  });

  it("enforces salesperson scope for health and stage history", async () => {
    const leadA = await createLead(ownerContext, {
      fullName: "Sales A Private Lead",
      phone: "+201000000004",
      assignedUserId: salesAUserId,
      status: "NEW",
    });
    const leadB = await createLead(ownerContext, {
      fullName: "Sales B Private Lead",
      phone: "+201000000005",
      assignedUserId: salesBUserId,
      status: "NEW",
    });

    const salesAHealth = await listLeadFollowUpHealth(salesAContext);
    expect(salesAHealth.some((row) => row.leadId === leadA.id)).toBe(true);
    expect(salesAHealth.some((row) => row.leadId === leadB.id)).toBe(false);

    await expect(
      updateLeadStatus(salesAContext, leadB.id, "CONTACTED"),
    ).rejects.toThrow(ForbiddenError);

    await expect(listLeadStageHistory(salesAContext, leadB.id)).rejects.toThrow(
      ForbiddenError,
    );

    const salesBLead = await getLead(salesBContext, leadB.id);
    expect(salesBLead.status).toBe("NEW");
  });
});
