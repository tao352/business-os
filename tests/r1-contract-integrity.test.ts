import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  createContract,
  createLead,
  createOrganization,
  createProject,
  createReservation,
  createUnit,
  signContract,
  registerUser,
} from "../packages/core/src/index.js";

describe("R1 contract integrity", () => {
  it("rejects a reservation that does not match the supplied Lead and Unit", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.contract.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Contract Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Contract Org ${suffix}`,
      slug: `r1-contract-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-contract-${suffix}`,
    };

    const project = await createProject(context, {
      name: "R1 Contract Project",
      location: "Test Location",
      projectType: "RESIDENTIAL",
      totalUnits: 2,
    });

    const unitA = await createUnit(context, {
      projectId: project.id,
      unitNumber: `A-${suffix}`,
      unitType: "APARTMENT",
      grossArea: 120,
      price: 2000000,
    });
    const unitB = await createUnit(context, {
      projectId: project.id,
      unitNumber: `B-${suffix}`,
      unitType: "APARTMENT",
      grossArea: 130,
      price: 2200000,
    });

    const leadA = await createLead(context, {
      fullName: "Reservation Owner Lead",
      phone: `20100${suffix}1`,
    });
    const leadB = await createLead(context, {
      fullName: "Different Contract Lead",
      phone: `20100${suffix}2`,
    });

    const reservation = await createReservation(context, {
      leadId: leadA.id,
      unitId: unitA.id,
      depositAmount: 50000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await expect(
      createContract(context, {
        reservationId: reservation.id,
        leadId: leadB.id,
        unitId: unitB.id,
        contractNumber: `R1-MISMATCH-${suffix}`,
        contractValue: 2200000,
        status: "SIGNED",
      }),
    ).rejects.toThrow(
      "Reservation does not belong to the supplied Lead and Unit",
    );

    const state = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const reservationRes = await tx.query(
          "SELECT status FROM reservations WHERE id = $1",
          [reservation.id],
        );
        const unitARes = await tx.query(
          "SELECT status FROM units WHERE id = $1",
          [unitA.id],
        );
        const unitBRes = await tx.query(
          "SELECT status FROM units WHERE id = $1",
          [unitB.id],
        );
        const leadARes = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [leadA.id],
        );
        const leadBRes = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [leadB.id],
        );
        return {
          reservationStatus: reservationRes.rows[0]?.status,
          unitAStatus: unitARes.rows[0]?.status,
          unitBStatus: unitBRes.rows[0]?.status,
          leadAStatus: leadARes.rows[0]?.status,
          leadBStatus: leadBRes.rows[0]?.status,
        };
      },
    );

    expect(state).toEqual({
      reservationStatus: "CONFIRMED",
      unitAStatus: "RESERVED",
      unitBStatus: "AVAILABLE",
      leadAStatus: "RESERVED",
      leadBStatus: "NEW",
    });
  });

  it("keeps a reservation active for Draft contracts and converts it on signing", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.contract.draft.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Draft Contract Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Draft Contract Org ${suffix}`,
      slug: `r1-contract-draft-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-contract-draft-${suffix}`,
    };

    const project = await createProject(context, {
      name: "R1 Draft Contract Project",
      location: "Test Location",
      projectType: "RESIDENTIAL",
      totalUnits: 1,
    });
    const unit = await createUnit(context, {
      projectId: project.id,
      unitNumber: `DRAFT-${suffix}`,
      unitType: "APARTMENT",
      grossArea: 115,
      price: 1900000,
    });
    const lead = await createLead(context, {
      fullName: "Draft Contract Lead",
      phone: `20101${suffix}1`,
    });
    const reservation = await createReservation(context, {
      leadId: lead.id,
      unitId: unit.id,
      depositAmount: 50000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const draft = await createContract(context, {
      reservationId: reservation.id,
      leadId: lead.id,
      unitId: unit.id,
      contractNumber: `R1-DRAFT-${suffix}`,
      contractValue: 1900000,
      status: "DRAFT",
    });

    const beforeSigning = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const reservationRes = await tx.query(
          "SELECT status FROM reservations WHERE id = $1",
          [reservation.id],
        );
        const unitRes = await tx.query(
          "SELECT status FROM units WHERE id = $1",
          [unit.id],
        );
        const leadRes = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [lead.id],
        );
        return {
          reservationStatus: reservationRes.rows[0]?.status,
          unitStatus: unitRes.rows[0]?.status,
          leadStatus: leadRes.rows[0]?.status,
        };
      },
    );

    expect(draft.status).toBe("DRAFT");
    expect(beforeSigning).toEqual({
      reservationStatus: "CONFIRMED",
      unitStatus: "RESERVED",
      leadStatus: "RESERVED",
    });

    const signed = await signContract(
      context,
      draft.id,
      new Date().toISOString(),
    );

    const afterSigning = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const reservationRes = await tx.query(
          "SELECT status FROM reservations WHERE id = $1",
          [reservation.id],
        );
        const unitRes = await tx.query(
          "SELECT status FROM units WHERE id = $1",
          [unit.id],
        );
        const leadRes = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [lead.id],
        );
        return {
          reservationStatus: reservationRes.rows[0]?.status,
          unitStatus: unitRes.rows[0]?.status,
          leadStatus: leadRes.rows[0]?.status,
        };
      },
    );

    expect(signed.status).toBe("SIGNED");
    expect(afterSigning).toEqual({
      reservationStatus: "CONVERTED",
      unitStatus: "CONTRACTED",
      leadStatus: "CONTRACTED",
    });
  });
});
