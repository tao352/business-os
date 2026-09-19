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
 * Seeds high-fidelity Egyptian real estate commercial data for pilot tenants (Section 55 & 67).
 */
export async function seedPilotRealEstateData(
  context: TenantContext,
): Promise<SeededRealEstateData> {
  logger.info(
    { organizationId: context.organizationId },
    "Seeding pilot real estate data",
  );

  // 1. Seed Projects
  const tajCity = await createProject(context, {
    name: "كمبوند تاج سيتي (Taj City) - التجمع الخامس",
    location: "القاهرة الجديدة، الطريق الدائري أمام فندق ماريوت",
    description: "مشروع سكني تجاري متكامل على مساحة 3.5 مليون متر مربع",
    totalUnits: 1500,
  });

  const sarai = await createProject(context, {
    name: "كمبوند سراي (Sarai) - طريق السويس",
    location: "القاهرة الجديدة، طريق القاهرة - السويس بجوار مدينتي",
    description:
      "مجتمع سكني حديث يتميز ببحيرات كريستالية لاجون ومساحات خضراء شاسعة",
    totalUnits: 2200,
  });

  // 2. Seed Units in Taj City
  const villa = await createUnit(context, {
    projectId: tajCity.id,
    unitNumber: "V-101",
    unitType: "VILLA",
    grossArea: 320,
    price: 18500000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const twinHouse = await createUnit(context, {
    projectId: tajCity.id,
    unitNumber: "TH-202",
    unitType: "TWIN_HOUSE",
    grossArea: 240,
    price: 14200000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const apartment = await createUnit(context, {
    projectId: sarai.id,
    unitNumber: "APT-305",
    unitType: "APARTMENT",
    grossArea: 155,
    price: 7800000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  // 3. Seed Marketing Campaign & Realistic Leads
  await logCampaignSpend(context, {
    campaignId: "cmp_taj_launch_2026",
    campaignName: "إطلاق مرحلة الفيلات - تاج سيتي",
    source: "FACEBOOK_LEAD_ADS",
    spendAmount: 250000,
    spendDate: "2026-09-01",
  });

  const lead1 = await createLead(context, {
    fullName: "المهندس هاني عزب",
    phone: "+201011112222",
    email: "hany.azab@arabcontractors.eg",
    source: "FACEBOOK_LEAD_ADS",
    campaignId: "cmp_taj_launch_2026",
    status: "NEW",
  });

  const lead2 = await createLead(context, {
    fullName: "الدكتورة سمر كمال",
    phone: "+201122223333",
    email: "dr.samar@cairo-cure.eg",
    source: "WHATSAPP",
    status: "CONTACTED",
  });

  const lead3 = await createLead(context, {
    fullName: "الأستاذ عمرو دياب",
    phone: "+201233334444",
    email: "amr.diab@media-group.eg",
    source: "REFERRAL",
    status: "QUALIFIED",
  });

  // 4. Seed Core Smart Automation Rule
  const autoAssignRule = await createRule(context, {
    name: "توزيع الليدات الواردة تلقائياً بالتناوب العادل",
    description:
      "توزيع فوري للعملاء الجدد على أعضاء فريق المبيعات بنظام Round-Robin",
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

  // 5. Generate Standard 8-Year Real Estate Payment Schedule
  const paymentPlanSample = generatePaymentSchedule({
    totalPrice: Number(villa.price),
    downPaymentPercent: 10,
    installmentsYears: 8,
    frequency: "QUARTERLY",
    startDate: "2026-10-01",
    deliveryDate: "2029-10-01",
    deliveryPaymentPercent: 10,
  });

  logger.info(
    {
      organizationId: context.organizationId,
      projectsCount: 2,
      unitsCount: 3,
      leadsCount: 3,
    },
    "Pilot real estate seed data successfully created",
  );

  return {
    projects: [tajCity, sarai],
    units: [villa, twinHouse, apartment],
    leads: [lead1, lead2, lead3],
    rules: [autoAssignRule],
    paymentPlanSample,
  };
}
