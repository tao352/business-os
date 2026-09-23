import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  cancelReservation,
  createContract,
  createLead,
  createOpportunity,
  createOrganization,
  createProject,
  createReservation,
  createUnit,
  expireStaleReservations,
  ForbiddenError,
  getExecutiveDashboard,
  inviteMember,
  listOpportunities,
  registerUser,
  reopenOpportunity,
  signContract,
  updateOpportunityStage,
} from "../packages/core/src/index.js";

async function createR13cFixture(label: string, unitCount = 6) {
  const suffix = crypto.randomBytes(4).toString("hex");
  const owner = await registerUser({
    email: `r13c.${label}.${suffix}@example.test`,
    password: "StrongPassword123!",
    fullName: `R1.3C ${label} Owner`,
  });
  const organization = await createOrganization({
    userId: owner.id,
    name: `R1.3C ${label} Org ${suffix}`,
    slug: `r13c-${label.toLowerCase()}-${suffix}`,
  });
  const context: TenantContext = {
    organizationId: organization.id,
    userId: owner.id,
    role: "OWNER",
    correlationId: `r13c-${label.toLowerCase()}-${suffix}`,
  };
  const project = await createProject(context, {
    name: `R1.3C ${label} Project`,
    location: "Test Location",
    projectType: "RESIDENTIAL",
    totalUnits: unitCount,
  });
  const units = await Promise.all(
    Array.from({ length: unitCount }, (_, index) =>
      createUnit(context, {
        projectId: project.id,
        unitNumber: `${label}-${index + 1}-${suffix}`,
        unitType: "APARTMENT",
        grossArea: 100 + index * 5,
        price: 2_000_000 + index * 100_000,
      }),
    ),
  );

  return { suffix, owner, organization, context, units };
}

async function readOpportunity(
  context: TenantContext,
  opportunityId: string,
): Promise<Record<string, any>> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      "SELECT * FROM deals WHERE organization_id = $1 AND id = $2",
      [context.organizationId, opportunityId],
    );
    return res.rows[0] as Record<string, any>;
  });
}

async function readReservation(
  context: TenantContext,
  reservationId: string,
): Promise<Record<string, any>> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      "SELECT * FROM reservations WHERE organization_id = $1 AND id = $2",
      [context.organizationId, reservationId],
    );
    return res.rows[0] as Record<string, any>;
  });
}

async function readContract(
  context: TenantContext,
  contractId: string,
): Promise<Record<string, any>> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      "SELECT * FROM contracts WHERE organization_id = $1 AND id = $2",
      [context.organizationId, contractId],
    );
    return res.rows[0] as Record<string, any>;
  });
}

async function readUnitStatus(
  context: TenantContext,
  unitId: string,
): Promise<string> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      "SELECT status FROM units WHERE organization_id = $1 AND id = $2",
      [context.organizationId, unitId],
    );
    return String(res.rows[0]?.status);
  });
}

describe("R1.3C Opportunity lifecycle", () => {
  it("records lifecycle history, requires Opportunity-level loss reason, and reopens explicitly", async () => {
    const { suffix, context } = await createR13cFixture("Lifecycle");
    const lead = await createLead(context, {
      fullName: "Lifecycle Customer",
      phone: `570${suffix}`,
    });

    await expect(
      createOpportunity(context, {
        leadId: lead.id,
        title: "Invalid lost-at-creation opportunity",
        value: 100_000,
        stage: "LOST",
      }),
    ).rejects.toThrow("Opportunity lost reason is required");

    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Lifecycle opportunity",
      value: 2_500_000,
      currency: "EGP",
    });
    expect(opportunity.stage).toBe("DISCOVERY");
    expect(opportunity.stage_entered_at).toBeTruthy();
    expect(opportunity.closed_at).toBeNull();

    const proposal = await updateOpportunityStage(
      context,
      opportunity.id,
      "PROPOSAL",
    );
    expect(proposal.stage).toBe("PROPOSAL");

    await expect(
      updateOpportunityStage(context, opportunity.id, "LOST"),
    ).rejects.toThrow("Opportunity lost reason is required");

    const lost = await updateOpportunityStage(context, opportunity.id, "LOST", {
      lostReasonCode: "PRICE",
      lostReasonNotes: "Customer decided the budget is too high.",
    });
    expect(lost.stage).toBe("LOST");
    expect(lost.lost_reason_code).toBe("PRICE");
    expect(lost.closed_at).toBeTruthy();

    await expect(
      updateOpportunityStage(context, opportunity.id, "DISCOVERY"),
    ).rejects.toThrow("must be reopened explicitly");

    const reopened = await reopenOpportunity(
      context,
      opportunity.id,
      "NEGOTIATION",
    );
    expect(reopened.stage).toBe("NEGOTIATION");
    expect(reopened.lost_reason_code).toBeNull();
    expect(reopened.lost_reason_notes).toBeNull();
    expect(reopened.closed_at).toBeNull();

    const history = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const res = await tx.query(
          `SELECT from_stage, to_stage, transition_source, reason_code
           FROM opportunity_stage_history
           WHERE organization_id = $1 AND opportunity_id = $2
           ORDER BY created_at ASC, id ASC`,
          [context.organizationId, opportunity.id],
        );
        return res.rows;
      },
    );

    expect(
      history.some(
        (row) =>
          row.from_stage === null &&
          row.to_stage === "DISCOVERY" &&
          row.transition_source === "opportunity_created",
      ),
    ).toBe(true);
    expect(
      history.some(
        (row) =>
          row.to_stage === "LOST" &&
          row.transition_source === "manual" &&
          row.reason_code === "PRICE",
      ),
    ).toBe(true);
    expect(
      history.some(
        (row) =>
          row.from_stage === "LOST" &&
          row.to_stage === "NEGOTIATION" &&
          row.transition_source === "opportunity_reopened",
      ),
    ).toBe(true);

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          `UPDATE opportunity_stage_history
           SET transition_source = 'tampered'
           WHERE organization_id = $1 AND opportunity_id = $2`,
          [context.organizationId, opportunity.id],
        );
      }),
    ).rejects.toThrow();
  });

  it("advances only the linked Opportunity on Reservation and never auto-loses it on cancellation", async () => {
    const { suffix, context, units } = await createR13cFixture("Reservation");
    const lead = await createLead(context, {
      fullName: "Reservation Customer",
      phone: `571${suffix}`,
    });

    const linked = await createOpportunity(context, {
      leadId: lead.id,
      title: "Apartment opportunity",
      value: 2_000_000,
      currency: "EGP",
    });
    const other = await createOpportunity(context, {
      leadId: lead.id,
      title: "Retail opportunity",
      value: 3_000_000,
      currency: "EGP",
    });

    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      opportunityId: linked.id,
      depositAmount: 50_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect((await readOpportunity(context, linked.id)).stage).toBe(
      "NEGOTIATION",
    );
    expect((await readOpportunity(context, other.id)).stage).toBe("DISCOVERY");

    await cancelReservation(context, reservation.id, "Customer changing unit");
    expect((await readOpportunity(context, linked.id)).stage).toBe(
      "NEGOTIATION",
    );

    const unlinkedReservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[1]!.id,
      depositAmount: 40_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(unlinkedReservation.opportunity_id ?? null).toBeNull();
    expect((await readOpportunity(context, other.id)).stage).toBe("DISCOVERY");

    await cancelReservation(context, unlinkedReservation.id);

    await updateOpportunityStage(context, linked.id, "LOST", {
      lostReasonCode: "CUSTOMER_WITHDREW",
    });

    await expect(
      createReservation(context, {
        leadId: lead.id,
        unitId: units[2]!.id,
        opportunityId: linked.id,
        depositAmount: 55_000,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow("Cannot reserve against a closed Opportunity");

    expect(await readUnitStatus(context, units[2]!.id)).toBe("AVAILABLE");

    const wonOpportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Already won opportunity",
      value: 2_200_000,
      currency: "EGP",
    });
    await updateOpportunityStage(context, wonOpportunity.id, "WON");

    await expect(
      createReservation(context, {
        leadId: lead.id,
        unitId: units[3]!.id,
        opportunityId: wonOpportunity.id,
        depositAmount: 60_000,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow("Cannot reserve against a closed Opportunity");

    expect(await readUnitStatus(context, units[3]!.id)).toBe("AVAILABLE");
  });

  it("lets Finance derive WON through Contract execution without granting manual Opportunity mutation", async () => {
    const { suffix, context, units } = await createR13cFixture("Finance");
    const lead = await createLead(context, {
      fullName: "Finance Execution Customer",
      phone: `572${suffix}`,
    });
    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Finance-signable opportunity",
      value: 2_000_000,
      currency: "EGP",
    });
    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      opportunityId: opportunity.id,
      depositAmount: 50_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect((await readOpportunity(context, opportunity.id)).stage).toBe(
      "NEGOTIATION",
    );

    const draft = await createContract(context, {
      reservationId: reservation.id,
      leadId: lead.id,
      unitId: units[0]!.id,
      contractNumber: `R13C-FIN-${suffix}`,
      contractValue: 2_000_000,
      status: "DRAFT",
    });
    expect((await readOpportunity(context, opportunity.id)).stage).toBe(
      "NEGOTIATION",
    );

    const finance = await inviteMember(context, {
      email: `r13c.finance-user.${suffix}@example.test`,
      fullName: "R1.3C Finance User",
      role: "FINANCE",
    });
    const financeContext: TenantContext = {
      organizationId: context.organizationId,
      userId: finance.userId,
      role: "FINANCE",
      correlationId: `r13c-finance-${suffix}`,
    };

    await expect(listOpportunities(financeContext)).rejects.toThrow(
      ForbiddenError,
    );

    const signed = await signContract(
      financeContext,
      draft.id,
      new Date().toISOString(),
    );
    expect(signed.status).toBe("SIGNED");
    expect((await readOpportunity(context, opportunity.id)).stage).toBe("WON");

    const wonHistory = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const res = await tx.query(
          `SELECT transition_source, changed_by_user_id
           FROM opportunity_stage_history
           WHERE organization_id = $1
             AND opportunity_id = $2
             AND to_stage = 'WON'`,
          [context.organizationId, opportunity.id],
        );
        return res.rows[0];
      },
    );
    expect(wonHistory?.transition_source).toBe("contract_executed");
    expect(wonHistory?.changed_by_user_id).toBe(finance.userId);
  });

  it("rolls back Contract execution atomically when the linked Opportunity is LOST", async () => {
    const { suffix, context, units } = await createR13cFixture("Rollback");
    const lead = await createLead(context, {
      fullName: "Rollback Customer",
      phone: `573${suffix}`,
    });
    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Rollback opportunity",
      value: 2_100_000,
      currency: "EGP",
    });
    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      opportunityId: opportunity.id,
      depositAmount: 60_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const draft = await createContract(context, {
      reservationId: reservation.id,
      leadId: lead.id,
      unitId: units[0]!.id,
      contractNumber: `R13C-ROLLBACK-${suffix}`,
      contractValue: 2_100_000,
      status: "DRAFT",
    });

    await updateOpportunityStage(context, opportunity.id, "LOST", {
      lostReasonCode: "TIMING",
    });

    await expect(
      signContract(context, draft.id, new Date().toISOString()),
    ).rejects.toThrow("Cannot execute a Contract against a LOST Opportunity");

    expect((await readOpportunity(context, opportunity.id)).stage).toBe("LOST");
    expect((await readContract(context, draft.id)).status).toBe("DRAFT");
    expect((await readReservation(context, reservation.id)).status).toBe(
      "CONFIRMED",
    );
    expect(await readUnitStatus(context, units[0]!.id)).toBe("RESERVED");
  });

  it("uses only open Opportunities for forecast and counts executed Contract states", async () => {
    const { suffix, context, units } = await createR13cFixture("Analytics", 7);
    const lead = await createLead(context, {
      fullName: "Analytics Customer",
      phone: `574${suffix}`,
    });

    await createOpportunity(context, {
      leadId: lead.id,
      title: "Open forecast",
      value: 1_000_000,
      currency: "EGP",
    });
    const won = await createOpportunity(context, {
      leadId: lead.id,
      title: "Won forecast",
      value: 2_000_000,
      currency: "EGP",
    });
    const lost = await createOpportunity(context, {
      leadId: lead.id,
      title: "Lost forecast",
      value: 3_000_000,
      currency: "EGP",
    });
    await updateOpportunityStage(context, won.id, "WON");
    await updateOpportunityStage(context, lost.id, "LOST", {
      lostReasonCode: "COMPETITOR",
    });

    await createContract(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      contractNumber: `R13C-SIGNED-${suffix}`,
      contractValue: 100_000,
      status: "SIGNED",
    });
    await createContract(context, {
      leadId: lead.id,
      unitId: units[1]!.id,
      contractNumber: `R13C-ACTIVE-${suffix}`,
      contractValue: 200_000,
      status: "ACTIVE",
    });
    await createContract(context, {
      leadId: lead.id,
      unitId: units[2]!.id,
      contractNumber: `R13C-COMPLETE-${suffix}`,
      contractValue: 300_000,
      status: "COMPLETED",
    });
    await createContract(context, {
      leadId: lead.id,
      unitId: units[3]!.id,
      contractNumber: `R13C-TERMINATED-${suffix}`,
      contractValue: 400_000,
      status: "TERMINATED",
    });

    const dashboard = await getExecutiveDashboard(context);
    expect(dashboard.pipelineValue).toBe(1_000_000);
    expect(dashboard.totalContracts).toBe(3);
  });

  it("keeps Opportunity open when a linked Reservation expires", async () => {
    const { suffix, context, units } = await createR13cFixture("Expiry");
    const lead = await createLead(context, {
      fullName: "Expiry Customer",
      phone: `575${suffix}`,
    });
    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Expiring reservation opportunity",
      value: 2_300_000,
      currency: "EGP",
    });
    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      opportunityId: opportunity.id,
      depositAmount: 45_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await withTenantContext(context.organizationId, async (tx) => {
      await tx.query(
        `UPDATE reservations
         SET expires_at = NOW() - INTERVAL '1 hour'
         WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, reservation.id],
      );
    });

    const result = await expireStaleReservations(context);
    expect(result.expiredReservationIds).toContain(reservation.id);
    expect((await readReservation(context, reservation.id)).status).toBe(
      "EXPIRED",
    );
    expect((await readOpportunity(context, opportunity.id)).stage).toBe(
      "NEGOTIATION",
    );
  });

  it("derives WON when Contracts are created directly as ACTIVE or COMPLETED", async () => {
    const { suffix, context, units } =
      await createR13cFixture("DirectExecution");

    const activeLead = await createLead(context, {
      fullName: "Active Contract Customer",
      phone: `576${suffix}1`,
    });
    const activeOpportunity = await createOpportunity(context, {
      leadId: activeLead.id,
      title: "Active contract opportunity",
      value: 2_400_000,
      currency: "EGP",
    });

    const activeContract = await createContract(context, {
      leadId: activeLead.id,
      unitId: units[0]!.id,
      opportunityId: activeOpportunity.id,
      contractNumber: `R13C-ACTIVE-DIRECT-${suffix}`,
      contractValue: 2_400_000,
      status: "ACTIVE",
    });
    expect(activeContract.status).toBe("ACTIVE");
    expect((await readOpportunity(context, activeOpportunity.id)).stage).toBe(
      "WON",
    );

    const completedLead = await createLead(context, {
      fullName: "Completed Contract Customer",
      phone: `576${suffix}2`,
    });
    const completedOpportunity = await createOpportunity(context, {
      leadId: completedLead.id,
      title: "Completed contract opportunity",
      value: 2_600_000,
      currency: "EGP",
    });

    const completedContract = await createContract(context, {
      leadId: completedLead.id,
      unitId: units[1]!.id,
      opportunityId: completedOpportunity.id,
      contractNumber: `R13C-COMPLETED-DIRECT-${suffix}`,
      contractValue: 2_600_000,
      status: "COMPLETED",
    });
    expect(completedContract.status).toBe("COMPLETED");
    expect(
      (await readOpportunity(context, completedOpportunity.id)).stage,
    ).toBe("WON");
  });

  it("keeps Opportunity lifecycle and history isolated between tenants", async () => {
    const first = await createR13cFixture("TenantA");
    const second = await createR13cFixture("TenantB");

    const lead = await createLead(first.context, {
      fullName: "Tenant A Customer",
      phone: `577${first.suffix}`,
    });
    const opportunity = await createOpportunity(first.context, {
      leadId: lead.id,
      title: "Tenant-isolated opportunity",
      value: 1_800_000,
      currency: "EGP",
    });

    await expect(
      updateOpportunityStage(second.context, opportunity.id, "PROPOSAL"),
    ).rejects.toThrow("Opportunity not found");

    const foreignHistoryCount = await withTenantContext(
      second.context.organizationId,
      async (tx) => {
        const res = await tx.query(
          `SELECT COUNT(*)::int AS count
           FROM opportunity_stage_history
           WHERE opportunity_id = $1`,
          [opportunity.id],
        );
        return Number(res.rows[0]?.count ?? 0);
      },
    );

    expect(foreignHistoryCount).toBe(0);
    expect((await readOpportunity(first.context, opportunity.id)).stage).toBe(
      "DISCOVERY",
    );
  });
});
