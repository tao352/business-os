import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  provisionPilotOrganization,
  seedPilotRealEstateData,
} from "../packages/core/src/pilot/index.js";
import { isFeatureEnabled } from "../packages/core/src/ops/index.js";
import { createReservation } from "../packages/core/src/real-estate/reservation-service.js";
import { createContract } from "../packages/core/src/real-estate/contract-service.js";
import { getUnit } from "../packages/core/src/real-estate/unit-service.js";
import { listProjects } from "../packages/core/src/real-estate/project-service.js";
import { calculateCampaignAttribution } from "../packages/core/src/analytics/attribution-service.js";
import { getExecutiveDashboard } from "../packages/core/src/analytics/dashboard-service.js";
import { registerUser } from "../packages/core/src/auth/auth-service.js";
import { createOrganization } from "../packages/core/src/auth/index.js";

describe("Phase 19: Pilot Customer Onboarding & End-to-End Validation", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");

  let pilotContext: TenantContext;
  let pilotOrgId: string;
  let repUserId: string;
  let orgBContext: TenantContext;

  beforeAll(async () => {
    // 1. Setup isolated Org B (for zero-leak verification)
    const ownerB = await registerUser({
      email: `pilot.b.${uniqueSuffix}@isolated.eg`,
      password: "StrongPassword2026!",
      fullName: "Tamer Hosny",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Competitor Real Estate ${uniqueSuffix}`,
      slug: `comp-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `comp-org-${uniqueSuffix}`,
    };
  });

  describe("1. Pilot Organization Provisioning & Feature Flags", () => {
    it("should provision a complete pilot developer organization with staff and feature flags", async () => {
      const pilot = await provisionPilotOrganization({
        organizationName: `Madinet Masr Developments ${uniqueSuffix}`,
        slug: `madinet-masr-${uniqueSuffix}`,
        ownerEmail: `ceo.madinetmasr.${uniqueSuffix}@madinetmasr.eg`,
        ownerName: "عبد الله سلام",
        staff: [
          {
            email: `manager.ahmed.${uniqueSuffix}@madinetmasr.eg`,
            fullName: "أحمد شلبي",
            role: "SALES_MANAGER",
          },
          {
            email: `rep.mai.${uniqueSuffix}@madinetmasr.eg`,
            fullName: "مي إبراهيم",
            role: "SALESPERSON",
          },
        ],
      });

      expect(pilot.organizationId).toBeDefined();
      expect(pilot.staffCount).toBe(2);
      expect(pilot.activatedFlags).toContain("ai_builder_v1");
      expect(pilot.activatedFlags).toContain("pilot_experimental_dashboards");

      pilotContext = pilot.context;
      pilotOrgId = pilot.organizationId;

      // Verify feature flags are enabled for Pilot and disabled for Org B
      const aiBuilderForPilot = await isFeatureEnabled(
        "ai_builder_v1",
        pilotContext,
      );
      const aiBuilderForOrgB = await isFeatureEnabled(
        "ai_builder_v1",
        orgBContext,
      );

      expect(aiBuilderForPilot).toBe(true);
      expect(aiBuilderForOrgB).toBe(false);
    });
  });

  describe("2. Real Estate Pilot Seed Data Generation", () => {
    let seededData: Awaited<ReturnType<typeof seedPilotRealEstateData>>;

    it("should seed realistic Egyptian real estate projects, units, leads, and payment plans", async () => {
      seededData = await seedPilotRealEstateData(pilotContext);

      expect(seededData.projects).toHaveLength(2);
      expect(seededData.projects[0]?.name).toContain("تاج سيتي");
      expect(seededData.projects[1]?.name).toContain("سراي");

      expect(seededData.units).toHaveLength(3);
      expect(Number(seededData.units[0]?.price)).toBe(18500000); // 18.5M EGP Villa

      expect(seededData.leads).toHaveLength(3);
      expect(seededData.rules).toHaveLength(1);

      // Verify payment plan schedule breakdown
      const schedule = seededData.paymentPlanSample as any;
      expect(schedule.totalPrice).toBe(18500000);
      expect(schedule.downPaymentAmount).toBe(1850000); // 10%
      expect(schedule.installmentsCount).toBe(32); // 8 years * 4 quarters
    });

    it("should simulate the complete commercial real estate sales lifecycle", async () => {
      const villa = seededData.units[0]!;
      const lead = seededData.leads[0] as any;

      // Step A: Reserve Unit
      const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
      const reservation = await createReservation(pilotContext, {
        unitId: villa.id,
        leadId: lead.id,
        depositAmount: 500000,
        expiresAt,
        notes: "حجز مبدئي لفيلا تاون سيتي مع سداد جدية حجز",
      });

      expect(reservation.id).toBeDefined();
      expect(reservation.status).toBe("CONFIRMED");

      // Verify unit status is now RESERVED
      const updatedUnit = await getUnit(pilotContext, villa.id);
      expect(updatedUnit?.status).toBe("RESERVED");

      // Step B: Contract Signing & Deal Closing
      const contract = await createContract(pilotContext, {
        reservationId: reservation.id,
        unitId: villa.id,
        leadId: lead.id,
        contractNumber: `CTR-TAJ-${uniqueSuffix.toUpperCase()}`,
        contractValue: Number(villa.price),
        signedAt: new Date().toISOString(),
        status: "SIGNED",
      });

      expect(contract.id).toBeDefined();
      expect(Number(contract.contract_value)).toBe(18500000);

      // Step C: Verify Attribution for closed deal
      const attribution = await calculateCampaignAttribution(
        pilotContext,
        "FIRST_TOUCH",
      );
      expect(attribution.length).toBeGreaterThan(0);
      const metaAttr = attribution.find(
        (a) => a.source === "FACEBOOK_LEAD_ADS",
      );
      expect(metaAttr).toBeDefined();
      expect(metaAttr?.contractsCount).toBeGreaterThanOrEqual(1);

      // Step D: Verify Executive Dashboard reflects real metrics
      const dashboard = await getExecutiveDashboard(pilotContext);
      expect(dashboard.totalContracts).toBeGreaterThanOrEqual(1);
      expect(dashboard.totalLeads).toBeGreaterThanOrEqual(3);
    });
  });

  describe("3. Zero-Leak Multi-Tenant Verification", () => {
    it("should strictly isolate pilot real estate data from competitor organizations", async () => {
      const orgBProjects = await listProjects(orgBContext);
      const leakedTaj = orgBProjects.find((p) => p.name.includes("تاج سيتي"));
      const leakedSarai = orgBProjects.find((p) => p.name.includes("سراي"));

      expect(leakedTaj).toBeUndefined();
      expect(leakedSarai).toBeUndefined();

      const orgBDashboard = await getExecutiveDashboard(orgBContext);
      expect(orgBDashboard.totalContracts).toBe(0);
      expect(orgBDashboard.totalLeads).toBe(0);
    });
  });
});
