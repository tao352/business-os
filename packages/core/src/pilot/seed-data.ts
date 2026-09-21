import { logger } from "@business-os/logger";
import type { TenantContext, Project, Unit } from "@business-os/types";
import { createProject } from "../real-estate/project-service.js";
import { createUnit } from "../real-estate/unit-service.js";
import { createLead } from "../crm/lead-service.js";
import { createRule } from "../rules/rules-service.js";
import { generatePaymentSchedule } from "../real-estate/payment-plan-service.js";
import { logCampaignSpend } from "../analytics/attribution-service.js";

export interface SeededRealEstateData {
  projects: Project[];
  units: Unit[];
  leads: unknown[];
  rules: unknown[];
  paymentPlanSample: unknown;
}

/**
 * Seeds synthetic real estate domain test fixtures for pilot validation.
 * Uses strictly synthetic, non-fabricated fixtures (no invented developer metadata).
 */
export async function seedPilotRealEstateData(
  context: TenantContext,
): Promise<SeededRealEstateData> {
  logger.info(
    { organizationId: context.organizationId },
    "Seeding synthetic pilot real estate data",
  );

  // 1. Seed Synthetic Projects
  const projectBeta = await createProject(context, {
    name: "Test Residential Project Beta",
    location: "District Zone 1",
    description: "Synthetic residential compound test fixture",
    projectType: "RESIDENTIAL",
    constructionStatus: "UNDER_CONSTRUCTION",
    salesStatus: "SELLING",
    totalUnits: 120,
  });

  const complexGamma = await createProject(context, {
    name: "Test Commercial Complex Gamma",
    location: "Commercial Zone 2",
    description: "Synthetic commercial complex test fixture",
    projectType: "COMMERCIAL",
    constructionStatus: "UNDER_CONSTRUCTION",
    salesStatus: "SELLING",
    totalUnits: 80,
  });

  // 2. Seed Synthetic Units
  const unitA = await createUnit(context, {
    projectId: projectBeta.id,
    unitNumber: "Test Unit A-101",
    usageType: "RESIDENTIAL",
    unitType: "APARTMENT",
    modelName: "Model A",
    grossArea: 140,
    price: 4500000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const unitB = await createUnit(context, {
    projectId: projectBeta.id,
    unitNumber: "Test Unit B-202",
    usageType: "RESIDENTIAL",
    unitType: "DUPLEX",
    modelName: "Model B",
    grossArea: 210,
    price: 7200000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const unitC = await createUnit(context, {
    projectId: complexGamma.id,
    unitNumber: "Test Unit C-303",
    usageType: "COMMERCIAL",
    unitType: "RETAIL_STORE",
    modelName: "Model C",
    grossArea: 85,
    price: 3800000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  // 3. Seed Synthetic Marketing Campaign & Synthetic Leads
  await logCampaignSpend(context, {
    campaignId: "cmp_synthetic_test_01",
    campaignName: "Synthetic Marketing Campaign",
    source: "FACEBOOK_LEAD_ADS",
    spendAmount: 150000,
    spendDate: "2026-09-01",
  });

  const lead1 = await createLead(context, {
    fullName: "Test Customer 1",
    phone: "+201000000001",
    email: "test.customer1@example.com",
    source: "FACEBOOK_LEAD_ADS",
    campaignId: "cmp_synthetic_test_01",
    status: "NEW",
  });

  const lead2 = await createLead(context, {
    fullName: "Test Customer 2",
    phone: "+201000000002",
    email: "test.customer2@example.com",
    source: "WHATSAPP",
    status: "CONTACTED",
  });

  const lead3 = await createLead(context, {
    fullName: "Test Customer 3",
    phone: "+201000000003",
    email: "test.customer3@example.com",
    source: "REFERRAL",
    status: "QUALIFIED",
  });

  // 4. Seed Core Smart Automation Rule
  const autoAssignRule = await createRule(context, {
    name: "Synthetic Round Robin Distribution Rule",
    description: "Automated assignment of inbound leads among sales reps",
    trigger_type: "lead.created",
    conditions: [],
    actions: [
      {
        action_type: "lead.assign_round_robin",
        params: {},
        delay_seconds: 0,
      },
    ],
  });

  // 5. Generate Standard Real Estate Payment Schedule
  const paymentPlanSample = generatePaymentSchedule({
    totalPrice: Number(unitA.price),
    downPaymentPercent: 10,
    installmentsYears: 5,
    frequency: "QUARTERLY",
    startDate: "2026-10-01",
    deliveryDate: "2028-10-01",
    deliveryPaymentPercent: 10,
  });

  logger.info(
    {
      organizationId: context.organizationId,
      projectsCount: 2,
      unitsCount: 3,
      leadsCount: 3,
    },
    "Synthetic pilot real estate seed data successfully created",
  );

  return {
    projects: [projectBeta, complexGamma],
    units: [unitA, unitB, unitC],
    leads: [lead1, lead2, lead3],
    rules: [autoAssignRule],
    paymentPlanSample,
  };
}
