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
import { createDeal } from "../packages/core/src/crm/deal-service.js";
import { createProject } from "../packages/core/src/real-estate/project-service.js";
import { createUnit } from "../packages/core/src/real-estate/unit-service.js";
import {
  scheduleVisit,
  updateVisitStatus,
} from "../packages/core/src/real-estate/visit-service.js";
import { createReservation } from "../packages/core/src/real-estate/reservation-service.js";
import { createContract } from "../packages/core/src/real-estate/contract-service.js";
import {
  logCampaignSpend,
  calculateCampaignAttribution,
  getExecutiveDashboard,
} from "../packages/core/src/analytics/index.js";

describe("Phase 14: Marketing Attribution & Executive Dashboard Engine (Live Tests)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");

  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  let rep1Id: string;
  let rep2Id: string;

  const campaignMeta = `meta_villas_${uniqueSuffix}`;
  const campaignGoogle = `google_apts_${uniqueSuffix}`;

  beforeAll(async () => {
    // 1. Setup Org A (SODIC)
    const ownerA = await registerUser({
      email: `owner.sodic.${uniqueSuffix}@sodic.local`,
      password: "StrongPassword2026!",
      fullName: "Magued Sherif",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `SODIC Developments ${uniqueSuffix}`,
      slug: `sodic-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `analytics-org-a-${uniqueSuffix}`,
    };

    // Sales Reps
    const rep1 = await inviteMember(orgAContext, {
      email: `kareem.${uniqueSuffix}@sodic.local`,
      fullName: "Kareem Top Closer",
      role: "SALESPERSON",
    });
    rep1Id = rep1.userId;

    const rep2 = await inviteMember(orgAContext, {
      email: `omar.${uniqueSuffix}@sodic.local`,
      fullName: "Omar Sales Rep",
      role: "SALESPERSON",
    });
    rep2Id = rep2.userId;

    // 3. Setup Org B (Mountain View)
    const ownerB = await registerUser({
      email: `owner.mountainview.${uniqueSuffix}@mv.local`,
      password: "StrongPassword2026!",
      fullName: "Amr Soliman",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Mountain View ${uniqueSuffix}`,
      slug: `mv-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `analytics-org-b-${uniqueSuffix}`,
    };

    // 4. Log Marketing Spend for Org A
    await logCampaignSpend(orgAContext, {
      campaignId: campaignMeta,
      campaignName: "October VYE Villas Lead Generation",
      source: "FACEBOOK_LEAD_ADS",
      spendAmount: 100000,
      spendDate: "2026-09-01",
    });

    await logCampaignSpend(orgAContext, {
      campaignId: campaignGoogle,
      campaignName: "Eastown Apartments Search Ads",
      source: "GOOGLE_ADS",
      spendAmount: 40000,
      spendDate: "2026-09-01",
    });

    // 5. Seed Real Estate Inventory
    const project = await createProject(orgAContext, {
      name: `VYE Sodic ${uniqueSuffix}`,
      location: "New Zayed, Giza",
    });

    const unit1 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "VYE-Villa-01",
      unitType: "VILLA",
      price: 20000000,
      grossArea: 350,
    });

    const unit2 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "VYE-Town-02",
      unitType: "TOWNHOUSE",
      price: 12000000,
      grossArea: 240,
    });

    // 6. Seed Leads and Sales Pipeline
    // Lead 1 from Meta Campaign -> Visit -> Reservation -> Signed Contract with Rep 1
    const lead1 = await createLead(orgAContext, {
      fullName: "طارق طلعت",
      phone: `+2010887766${uniqueSuffix.slice(0, 2)}`,
      campaignId: campaignMeta,
      source: "FACEBOOK_LEAD_ADS",
      assignedUserId: rep1Id,
    });

    const visit1 = await scheduleVisit(orgAContext, {
      leadId: lead1.id,
      projectId: project.id,
      assignedAgentId: rep1Id,
      scheduledAt: new Date().toISOString(),
    });
    await updateVisitStatus(
      orgAContext,
      visit1.id,
      "COMPLETED",
      "Great buyer interest",
    );

    await createReservation(orgAContext, {
      leadId: lead1.id,
      unitId: unit1.id,
      depositAmount: 1000000,
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
    });

    await createContract(orgAContext, {
      leadId: lead1.id,
      unitId: unit1.id,
      contractNumber: `CTR-${uniqueSuffix}-01`,
      contractValue: 20000000,
      status: "SIGNED",
    });

    // Lead 2 from Google Campaign -> Deal open
    const lead2 = await createLead(orgAContext, {
      fullName: "حازم الديب",
      phone: `+2010776655${uniqueSuffix.slice(0, 2)}`,
      campaignId: campaignGoogle,
      source: "GOOGLE_ADS",
      assignedUserId: rep2Id,
    });

    await createDeal(orgAContext, {
      leadId: lead2.id,
      title: "VYE Townhouse Negotiation",
      value: 12000000,
      stage: "NEGOTIATION",
      assignedUserId: rep2Id,
    });
  });

  describe("1. Marketing Multi-Touch Attribution Engine", () => {
    it("calculates campaign metrics, ROAS, and CAC based on actual signed contracts", async () => {
      const attribution = await calculateCampaignAttribution(
        orgAContext,
        "LAST_TOUCH",
      );

      expect(attribution.length).toBeGreaterThanOrEqual(2);

      const metaMetric = attribution.find((m) => m.campaignId === campaignMeta);
      expect(metaMetric).toBeDefined();
      expect(metaMetric?.spendAmount).toBe(100000);
      expect(metaMetric?.leadsCount).toBe(1);
      expect(metaMetric?.visitsCount).toBe(1);
      expect(metaMetric?.contractsCount).toBe(1);
      expect(metaMetric?.totalRevenue).toBe(20000000);
      // ROAS = 20,000,000 / 100,000 = 200
      expect(metaMetric?.roas).toBe(200);
      // CAC = 100,000 / 1 = 100,000
      expect(metaMetric?.cac).toBe(100000);

      const googleMetric = attribution.find(
        (m) => m.campaignId === campaignGoogle,
      );
      expect(googleMetric).toBeDefined();
      expect(googleMetric?.spendAmount).toBe(40000);
      expect(googleMetric?.leadsCount).toBe(1);
      expect(googleMetric?.contractsCount).toBe(0);
      expect(googleMetric?.roas).toBe(0);
    });
  });

  describe("2. Real-Time Executive Dashboard KPIs & Sales Leaderboard", () => {
    it("aggregates organization-wide funnel, pipeline, deposits, and sales leaderboard", async () => {
      const dashboard = await getExecutiveDashboard(orgAContext);

      expect(dashboard.totalLeads).toBe(2);
      expect(dashboard.totalVisits).toBe(1);
      expect(dashboard.totalReservations).toBe(1);
      expect(dashboard.totalContracts).toBe(1);
      expect(dashboard.collectedDeposits).toBe(1000000);
      expect(dashboard.pipelineValue).toBe(12000000); // Deal for Lead 2

      // Funnel Conversion Rates
      expect(dashboard.leadToVisitRate).toBe(50); // 1 visit / 2 leads = 50%
      expect(dashboard.visitToContractRate).toBe(100); // 1 contract / 1 visit = 100%

      // Sales Leaderboard
      expect(dashboard.salesLeaderboard.length).toBeGreaterThan(0);
      const topCloser = dashboard.salesLeaderboard[0]!;
      expect(topCloser.userId).toBe(rep1Id);
      expect(topCloser.contractsCount).toBe(1);
      expect(topCloser.totalRevenue).toBe(20000000);

      // Inventory Status
      expect(dashboard.inventoryStatus.contractedUnits).toBe(1); // Unit 1 is contracted
      expect(dashboard.inventoryStatus.availableUnits).toBe(1); // Unit 2 is available
    });
  });

  describe("3. Multi-Tenant Financial & Analytics Isolation (Zero Leak Invariant)", () => {
    it("ensures Org B querying attribution or executive dashboard sees ZERO metrics from Org A", async () => {
      const orgBAttribution = await calculateCampaignAttribution(orgBContext);
      expect(orgBAttribution.length).toBe(0);

      const orgBDashboard = await getExecutiveDashboard(orgBContext);
      expect(orgBDashboard.totalLeads).toBe(0);
      expect(orgBDashboard.totalContracts).toBe(0);
      expect(orgBDashboard.totalRevenue ?? 0).toBe(0);
      expect(orgBDashboard.pipelineValue).toBe(0);
      expect(orgBDashboard.collectedDeposits).toBe(0);
      expect(orgBDashboard.salesLeaderboard.length).toBe(0);

      // Direct SQL Check inside Org B tenant session
      await withTenantContext(orgBContext.organizationId, async (tx) => {
        const leakedSpend = await tx.query("SELECT * FROM campaign_spend_logs");
        expect(leakedSpend.rows.length).toBe(0);
      });
    });
  });
});
