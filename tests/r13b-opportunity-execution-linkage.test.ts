import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  createContract,
  createLead,
  createOpportunity,
  createOrganization,
  createProject,
  createReservation,
  createUnit,
  listContracts,
  listReservations,
  registerUser,
  signContract,
} from "../packages/core/src/index.js";

async function createExecutionFixture(label: string) {
  const suffix = crypto.randomBytes(4).toString("hex");
  const owner = await registerUser({
    email: `r13b.${label}.${suffix}@example.test`,
    password: "StrongPassword123!",
    fullName: `R1.3B ${label} Owner`,
  });
  const organization = await createOrganization({
    userId: owner.id,
    name: `R1.3B ${label} Org ${suffix}`,
    slug: `r13b-${label.toLowerCase()}-${suffix}`,
  });
  const context: TenantContext = {
    organizationId: organization.id,
    userId: owner.id,
    role: "OWNER",
    correlationId: `r13b-${label.toLowerCase()}-${suffix}`,
  };
  const project = await createProject(context, {
    name: `R1.3B ${label} Project`,
    location: "Test Location",
    projectType: "RESIDENTIAL",
    totalUnits: 3,
  });
  const units = await Promise.all(
    ["A", "B", "C"].map((name, index) =>
      createUnit(context, {
        projectId: project.id,
        unitNumber: `${label}-${name}-${suffix}`,
        unitType: "APARTMENT",
        grossArea: 110 + index * 10,
        price: 2000000 + index * 250000,
      }),
    ),
  );

  return { suffix, context, units };
}

describe("R1.3B Opportunity execution linkage", () => {
  it("links Reservations explicitly and lets Contracts inherit the same Opportunity", async () => {
    const { suffix, context, units } = await createExecutionFixture("Link");
    const lead = await createLead(context, {
      fullName: "Opportunity Execution Lead",
      phone: `560${suffix}`,
    });
    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Primary purchase opportunity",
      value: 2000000,
      currency: "EGP",
    });

    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[0]!.id,
      opportunityId: opportunity.id,
      depositAmount: 50000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(reservation.opportunity_id).toBe(opportunity.id);

    const reservationList = await listReservations(context, {
      opportunityId: opportunity.id,
    });
    expect(reservationList.map((row) => row.id)).toContain(reservation.id);

    const draft = await createContract(context, {
      reservationId: reservation.id,
      leadId: lead.id,
      unitId: units[0]!.id,
      contractNumber: `R13B-INHERIT-${suffix}`,
      contractValue: 2000000,
      status: "DRAFT",
    });

    expect(draft.opportunity_id).toBe(opportunity.id);

    const contractList = await listContracts(context, {
      opportunityId: opportunity.id,
    });
    expect(contractList.map((row) => row.id)).toContain(draft.id);

    const signed = await signContract(
      context,
      draft.id,
      new Date().toISOString(),
    );
    expect(signed.opportunity_id).toBe(opportunity.id);

    // Explicit linkage on a legacy-style Reservation with no Opportunity is
    // deterministic: creating its Contract with an explicit Opportunity links
    // both records to exactly the same commercial opportunity.
    const legacyReservation = await createReservation(context, {
      leadId: lead.id,
      unitId: units[1]!.id,
      depositAmount: 60000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(legacyReservation.opportunity_id ?? null).toBeNull();

    const explicitContract = await createContract(context, {
      reservationId: legacyReservation.id,
      leadId: lead.id,
      unitId: units[1]!.id,
      opportunityId: opportunity.id,
      contractNumber: `R13B-EXPLICIT-${suffix}`,
      contractValue: 2250000,
      status: "DRAFT",
    });
    expect(explicitContract.opportunity_id).toBe(opportunity.id);

    const persistedReservation = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const res = await tx.query(
          "SELECT opportunity_id FROM reservations WHERE id = $1",
          [legacyReservation.id],
        );
        return res.rows[0]?.opportunity_id;
      },
    );
    expect(persistedReservation).toBe(opportunity.id);
  });

  it("rejects Lead and Reservation Opportunity mismatches at service and database boundaries", async () => {
    const { suffix, context, units } =
      await createExecutionFixture("Integrity");
    const leadA = await createLead(context, {
      fullName: "Integrity Lead A",
      phone: `561${suffix}1`,
    });
    const leadB = await createLead(context, {
      fullName: "Integrity Lead B",
      phone: `561${suffix}2`,
    });

    const opportunityA = await createOpportunity(context, {
      leadId: leadA.id,
      title: "Lead A primary opportunity",
      value: 2000000,
      currency: "EGP",
    });
    const opportunityA2 = await createOpportunity(context, {
      leadId: leadA.id,
      title: "Lead A second opportunity",
      value: 2100000,
      currency: "EGP",
    });
    const opportunityB = await createOpportunity(context, {
      leadId: leadB.id,
      title: "Lead B opportunity",
      value: 2200000,
      currency: "EGP",
    });

    await expect(
      createReservation(context, {
        leadId: leadA.id,
        unitId: units[0]!.id,
        opportunityId: opportunityB.id,
        depositAmount: 50000,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow("not found for Lead");

    const reservation = await createReservation(context, {
      leadId: leadA.id,
      unitId: units[0]!.id,
      opportunityId: opportunityA.id,
      depositAmount: 50000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await expect(
      createContract(context, {
        reservationId: reservation.id,
        leadId: leadA.id,
        unitId: units[0]!.id,
        opportunityId: opportunityA2.id,
        contractNumber: `R13B-MISMATCH-${suffix}`,
        contractValue: 2000000,
        status: "DRAFT",
      }),
    ).rejects.toThrow(
      "Contract Opportunity does not match the Reservation Opportunity",
    );

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          "UPDATE reservations SET opportunity_id = $1 WHERE id = $2",
          [opportunityB.id, reservation.id],
        );
      }),
    ).rejects.toThrow();

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          `INSERT INTO contracts (
            organization_id,
            reservation_id,
            lead_id,
            unit_id,
            opportunity_id,
            contract_number,
            contract_value,
            currency,
            payment_schedule,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EGP', '[]'::jsonb, 'DRAFT')`,
          [
            context.organizationId,
            reservation.id,
            leadA.id,
            units[0]!.id,
            opportunityA2.id,
            `R13B-DB-MISMATCH-${suffix}`,
            2000000,
          ],
        );
      }),
    ).rejects.toThrow();
  });

  it("enforces canonical Opportunity stage and non-negative value in PostgreSQL", async () => {
    const { suffix, context } = await createExecutionFixture("Guard");
    const lead = await createLead(context, {
      fullName: "Opportunity DB Guard Lead",
      phone: `562${suffix}`,
    });
    const opportunity = await createOpportunity(context, {
      leadId: lead.id,
      title: "Database guard opportunity",
      value: 1000000,
      currency: "EGP",
    });

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query("UPDATE deals SET stage = 'INVALID' WHERE id = $1", [
          opportunity.id,
        ]);
      }),
    ).rejects.toThrow();

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query("UPDATE deals SET value = -1 WHERE id = $1", [
          opportunity.id,
        ]);
      }),
    ).rejects.toThrow();
  });
});
