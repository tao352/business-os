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
 * Seeds high-fidelity Egyptian real estate commercial data for pilot tenants.
 * Aligned with Perfect Real Estate Development pilot projects (حي الصفوة & Ten Point Mall).
 */
export async function seedPilotRealEstateData(
  context: TenantContext,
): Promise<SeededRealEstateData> {
  logger.info(
    { organizationId: context.organizationId },
    "Seeding pilot real estate data",
  );

  // 1. Seed Projects (Hay Al Safwa & Ten Point Mall)
  const safwa = await createProject(context, {
    name: "كمبوند حي الصفوة (Hay Al Safwa) - الشروق",
    location: "مدينة الشروق",
    description: "مشروع سكني متكامل يتميز بالهدوء والمساحات الخضراء",
    projectType: "RESIDENTIAL",
    constructionStatus: "UNDER_CONSTRUCTION",
    salesStatus: "SELLING",
    totalUnits: 120,
  });

  const tenPoint = await createProject(context, {
    name: "مول تن بوينت (Ten Point Mall) - القاهرة الجديدة",
    location: "القاهرة الجديدة",
    description: "مركز تجاري وطبي وإداري متكامل في موقع حيوي",
    projectType: "COMMERCIAL",
    constructionStatus: "UNDER_CONSTRUCTION",
    salesStatus: "SELLING",
    totalUnits: 80,
  });

  // 2. Seed Units
  const villa = await createUnit(context, {
    projectId: safwa.id,
    unitNumber: "V-101",
    usageType: "RESIDENTIAL",
    unitType: "STANDALONE_VILLA",
    modelName: "فيلا مستقلة نموذج أ",
    grossArea: 320,
    price: 18500000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const twinHouse = await createUnit(context, {
    projectId: safwa.id,
    unitNumber: "TH-202",
    usageType: "RESIDENTIAL",
    unitType: "TWIN_HOUSE",
    modelName: "توين هاوس نموذج ب",
    grossArea: 240,
    price: 14200000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  const clinic = await createUnit(context, {
    projectId: tenPoint.id,
    unitNumber: "CL-305",
    usageType: "COMMERCIAL",
    unitType: "CLINIC",
    modelName: "عيادة طبية نموذج ج",
    grossArea: 75,
    price: 4500000,
    currency: "EGP",
    status: "AVAILABLE",
  });

  // 3. Seed Marketing Campaign & Realistic Leads
  await logCampaignSpend(context, {
    campaignId: "cmp_safwa_launch_2026",
    campaignName: "إطلاق مرحلة الفيلات - حي الصفوة",
    source: "FACEBOOK_LEAD_ADS",
    spendAmount: 250000,
    spendDate: "2026-09-01",
  });

  const lead1 = await createLead(context, {
    fullName: "المهندس هاني عزب",
    phone: "+201011112222",
    email: "hany.azab@arabcontractors.eg",
    source: "FACEBOOK_LEAD_ADS",
    campaignId: "cmp_safwa_launch_2026",
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
    projects: [safwa, tenPoint],
    units: [villa, twinHouse, clinic],
    leads: [lead1, lead2, lead3],
    rules: [autoAssignRule],
    paymentPlanSample,
  };
}
