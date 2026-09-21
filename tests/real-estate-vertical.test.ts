import { describe, it, expect, beforeAll } from "vitest";
import {
  generatePaymentSchedule,
  createProject,
  getProject,
  listProjects,
  createUnit,
  updateUnit,
  getUnit,
  listUnits,
  scheduleVisit,
  listVisits,
  updateVisitStatus,
  createReservation,
  cancelReservation,
  listReservations,
  expireStaleReservations,
  sweepExpiredReservations,
  UnitNotAvailableError,
  createContract,
  signContract,
  listContracts,
  registerUser,
  createOrganization,
  createLead,
  updateLead,
  listLeadActivities,
  addLeadInterest,
  listLeadInterests,
  getLeadInterest,
  updateLeadInterest,
  listProjectsOverview,
  listUnitsInventory,
  getLeadMatchedUnits,
} from "../packages/core/src/index.js";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import { ForbiddenError } from "../packages/core/src/permissions/types.js";

describe("Phase 7 & Phase 22: Real Estate Vertical Template & Domain Refinement", () => {
  describe("Unit: Mathematical Payment Plan & Installments Generator", () => {
    it("should generate an exact quarterly payment schedule for 5,000,000 EGP over 5 years", () => {
      const schedule = generatePaymentSchedule({
        totalPrice: 5000000,
        downPaymentPercent: 10,
        installmentsYears: 5,
        frequency: "QUARTERLY",
        deliveryPaymentPercent: 10,
        deliveryDate: "2029-06-30",
        startDate: "2026-06-01",
        maintenancePercent: 8,
      });

      expect(schedule.totalPrice).toBe(5000000);
      expect(schedule.downPaymentAmount).toBe(500000);
      expect(schedule.deliveryAmount).toBe(500000);
      expect(schedule.maintenanceAmount).toBe(400000);
      expect(schedule.installmentsCount).toBe(20); // 5 years * 4 quarters
      expect(schedule.installmentAmount).toBe(200000); // 4,000,000 / 20

      // Verify exact sum of principal payments (Down payment + 20 installments + Delivery = 5,000,000)
      const principalSum = schedule.schedule
        .filter((item) => item.type !== "MAINTENANCE")
        .reduce((sum, item) => sum + item.amount, 0);

      expect(principalSum).toBe(5000000);

      // Verify date steps (every 3 months)
      const firstInstallment = schedule.schedule.find(
        (s) => s.installmentNumber === 2,
      );
      expect(firstInstallment?.dueDate).toBe("2026-09-01");
    });

    it("should prevent decimal rounding drift on irregular prices and monthly installments with exact equality", () => {
      const schedule = generatePaymentSchedule({
        totalPrice: 1333333.33,
        downPaymentPercent: 15,
        installmentsYears: 3,
        frequency: "MONTHLY",
        startDate: "2026-01-01",
      });

      expect(schedule.installmentsCount).toBe(36);

      // Remainder allocated to final installment guarantees exact integer piastre equality
      const principalPiastres = schedule.schedule
        .filter((item) => item.type !== "MAINTENANCE")
        .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
      expect(principalPiastres).toBe(Math.round(1333333.33 * 100));

      const principalSum = schedule.schedule
        .filter((item) => item.type !== "MAINTENANCE")
        .reduce((sum, item) => sum + item.amount, 0);
      expect(principalSum).toBeCloseTo(1333333.33, 2);
    });

    it("should handle month-end day clamping across non-leap, leap, 30-day months, and year boundary", () => {
      // 1. Non-leap year: Jan 31 -> Feb 28, Mar 31, Apr 30
      const s2026 = generatePaymentSchedule({
        totalPrice: 1200000,
        downPaymentPercent: 10,
        installmentsYears: 1,
        frequency: "MONTHLY",
        startDate: "2026-01-31",
      });

      expect(s2026.schedule[0]?.dueDate).toBe("2026-01-31");
      expect(s2026.schedule[1]?.dueDate).toBe("2026-02-28"); // Clamped to Feb 28
      expect(s2026.schedule[2]?.dueDate).toBe("2026-03-31");
      expect(s2026.schedule[3]?.dueDate).toBe("2026-04-30"); // Clamped to Apr 30

      // 2. Leap year: Jan 31 -> Feb 29 in 2028
      const s2028 = generatePaymentSchedule({
        totalPrice: 600000,
        downPaymentPercent: 10,
        installmentsYears: 1,
        frequency: "MONTHLY",
        startDate: "2028-01-31",
      });
      expect(s2028.schedule[1]?.dueDate).toBe("2028-02-29"); // Clamped to Feb 29

      // 3. Quarterly clamping: Aug 31 -> Nov 30
      const sQuarterly = generatePaymentSchedule({
        totalPrice: 800000,
        downPaymentPercent: 10,
        installmentsYears: 1,
        frequency: "QUARTERLY",
        startDate: "2026-08-31",
      });
      expect(sQuarterly.schedule[1]?.dueDate).toBe("2026-11-30"); // Clamped to Nov 30

      // 4. Year boundary rollover: Dec 31 -> Jan 31
      const sYearEnd = generatePaymentSchedule({
        totalPrice: 400000,
        downPaymentPercent: 10,
        installmentsYears: 1,
        frequency: "MONTHLY",
        startDate: "2026-12-31",
      });
      expect(sYearEnd.schedule[1]?.dueDate).toBe("2027-01-31"); // Rolled to next year
    });

    it("should separate optional maintenance fee line item from purchase contract total", () => {
      const schedule = generatePaymentSchedule({
        totalPrice: 4000000,
        downPaymentPercent: 10,
        installmentsYears: 2,
        frequency: "QUARTERLY",
        maintenancePercent: 8,
        startDate: "2026-05-01",
      });

      expect(schedule.totalPrice).toBe(4000000);
      expect(schedule.maintenanceAmount).toBe(320000);

      const maintenanceItems = schedule.schedule.filter(
        (i) => i.type === "MAINTENANCE",
      );
      expect(maintenanceItems).toHaveLength(1);
      expect(maintenanceItems[0]?.amount).toBe(320000);

      const principalSum = schedule.schedule
        .filter((i) => i.type !== "MAINTENANCE")
        .reduce((sum, i) => sum + i.amount, 0);
      expect(principalSum).toBe(4000000);
    });

    it("should reject combined down payment and delivery payment percentages >= 100%", () => {
      // Combined > 100%
      expect(() =>
        generatePaymentSchedule({
          totalPrice: 1000000,
          downPaymentPercent: 80,
          deliveryPaymentPercent: 30,
          installmentsYears: 3,
          frequency: "QUARTERLY",
          startDate: "2026-01-01",
        }),
      ).toThrow();

      // Combined = 100%
      expect(() =>
        generatePaymentSchedule({
          totalPrice: 1000000,
          downPaymentPercent: 50,
          deliveryPaymentPercent: 50,
          installmentsYears: 3,
          frequency: "QUARTERLY",
          startDate: "2026-01-01",
        }),
      ).toThrow();

      // 100% down payment (no installments remaining)
      expect(() =>
        generatePaymentSchedule({
          totalPrice: 1000000,
          downPaymentPercent: 100,
          installmentsYears: 3,
          frequency: "QUARTERLY",
          startDate: "2026-01-01",
        }),
      ).toThrow();
    });

    it("should correctly handle fractional percentages and SEMI_ANNUAL / ANNUAL frequencies", () => {
      // Fractional percentages with SEMI_ANNUAL (every 6 months)
      const semi = generatePaymentSchedule({
        totalPrice: 2000000,
        downPaymentPercent: 12.5,
        deliveryPaymentPercent: 7.5,
        installmentsYears: 2,
        frequency: "SEMI_ANNUAL",
        startDate: "2026-03-01",
      });

      expect(semi.downPaymentAmount).toBe(250000); // 12.5% of 2M
      expect(semi.deliveryAmount).toBe(150000); // 7.5% of 2M
      expect(semi.installmentsCount).toBe(4); // 2 years * 2 semi-annual
      expect(semi.installmentAmount).toBe(400000); // (2M - 400K) / 4

      const semiDates = semi.schedule
        .filter((i) => i.type === "INSTALLMENT")
        .map((i) => i.dueDate);
      expect(semiDates).toEqual([
        "2026-09-01",
        "2027-03-01",
        "2027-09-01",
        "2028-03-01",
      ]);

      // ANNUAL frequency (every 12 months)
      const annual = generatePaymentSchedule({
        totalPrice: 3000000,
        downPaymentPercent: 10,
        installmentsYears: 3,
        frequency: "ANNUAL",
        startDate: "2026-06-15",
      });

      expect(annual.installmentsCount).toBe(3); // 3 years * 1 annual
      const annualDates = annual.schedule
        .filter((i) => i.type === "INSTALLMENT")
        .map((i) => i.dueDate);
      expect(annualDates).toEqual(["2027-06-15", "2028-06-15", "2029-06-15"]);
    });

    it("should correctly handle leap-year Feb 29 start date with annual and semi-annual clamping", () => {
      // Start date on leap day Feb 29, 2028
      const leapAnnual = generatePaymentSchedule({
        totalPrice: 1000000,
        downPaymentPercent: 10,
        installmentsYears: 4,
        frequency: "ANNUAL",
        startDate: "2028-02-29",
      });

      const dates = leapAnnual.schedule
        .filter((i) => i.type === "INSTALLMENT")
        .map((i) => i.dueDate);
      expect(dates).toEqual([
        "2029-02-28", // non-leap year clamped to 28
        "2030-02-28", // non-leap year clamped to 28
        "2031-02-28", // non-leap year clamped to 28
        "2032-02-29", // leap year preserves Feb 29!
      ]);
    });
  });

  describe("Integration: Real Estate Vertical Workflow & Multi-Tenancy", () => {
    let orgAContext: TenantContext;
    let orgBContext: TenantContext;
    let leadId: string;
    let projectId: string;
    let unitId: string;

    beforeAll(async () => {
      const suffix = Date.now().toString();

      // Tenant A
      const userA = await registerUser({
        email: `dev.re.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Real Estate Developer",
      });
      const orgA = await createOrganization({
        userId: userA.id,
        name: `Prestige Developments ${suffix}`,
        slug: `prestige-${suffix}`,
      });
      orgAContext = {
        organizationId: orgA.id,
        userId: userA.id,
        role: "OWNER",
        correlationId: `corr-re-${suffix}`,
      };

      // Tenant B (Foreign)
      const userB = await registerUser({
        email: `rival.re.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Rival Developer",
      });
      const orgB = await createOrganization({
        userId: userB.id,
        name: `Rival Real Estate ${suffix}`,
        slug: `rival-${suffix}`,
      });
      orgBContext = {
        organizationId: orgB.id,
        userId: userB.id,
        role: "OWNER",
        correlationId: `corr-rival-${suffix}`,
      };

      // Create a Lead in Tenant A
      const lead = await createLead(orgAContext, {
        fullName: "Youssef El-Sherif",
        phone: "01012345678",
        email: "youssef@buyer.com",
      });
      leadId = lead.id;
    });

    it("should create and manage projects with decoupled construction and sales statuses", async () => {
      const project = await createProject(orgAContext, {
        name: "Test Compound Alpha",
        location: "West District",
        description: "Boutique residential development",
        projectType: "RESIDENTIAL",
        constructionStatus: "PLANNING",
        salesStatus: "UPCOMING",
        totalUnits: 50,
        isActive: true,
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Test Compound Alpha");
      expect(project.project_type).toBe("RESIDENTIAL");
      expect(project.construction_status).toBe("PLANNING");
      expect(project.sales_status).toBe("UPCOMING");
      expect(project.is_active).toBe(true);
      expect(project.total_units).toBe(50);
      projectId = project.id;

      const fetched = await getProject(orgAContext, projectId);
      expect(fetched?.name).toBe("Test Compound Alpha");

      const allProjects = await listProjects(orgAContext);
      expect(allProjects.some((p) => p.id === projectId)).toBe(true);
    });

    it("should create units with standardized usage_type, unit_type, and model_name", async () => {
      const unit = await createUnit(orgAContext, {
        projectId,
        unitNumber: "V-102",
        usageType: "RESIDENTIAL",
        unitType: "STANDALONE_VILLA",
        modelName: "Type A Villa",
        grossArea: 320.5,
        price: 8500000,
        currency: "EGP",
        paymentPlanTemplate: {
          downPayment: 10,
          years: 7,
          frequency: "QUARTERLY",
        },
      });

      expect(unit.id).toBeDefined();
      expect(unit.unit_number).toBe("V-102");
      expect(unit.usage_type).toBe("RESIDENTIAL");
      expect(unit.unit_type).toBe("STANDALONE_VILLA");
      expect(unit.model_name).toBe("Type A Villa");
      expect(unit.status).toBe("AVAILABLE");
      unitId = unit.id;

      // Check project total_units remains authoritative declared total (not incremented)
      const project = await getProject(orgAContext, projectId);
      expect(project?.total_units).toBe(50);

      // Verify read model computes dynamic units_count
      const overview = await listProjectsOverview(orgAContext);
      const projOverview = overview.find((p) => p.id === projectId);
      expect(projOverview?.total_units).toBe(50);
      expect(projOverview?.units_count).toBe(1);

      // Verify list units
      const units = await listUnits(orgAContext, {
        projectId,
        status: "AVAILABLE",
      });
      expect(units).toHaveLength(1);
      expect(units[0]?.unit_number).toBe("V-102");
    });

    it("should infer usage type from unit type and reject contradictory classifications", async () => {
      const inferred = await createUnit(orgAContext, {
        projectId,
        unitNumber: "APT-INFER-01",
        unitType: "APARTMENT",
        grossArea: 135,
        price: 3200000,
      });
      expect(inferred.usage_type).toBe("RESIDENTIAL");

      const reclassified = await updateUnit(orgAContext, inferred.id, {
        unitType: "OFFICE",
      });
      expect(reclassified.unit_type).toBe("OFFICE");
      expect(reclassified.usage_type).toBe("ADMINISTRATIVE");

      await expect(
        createUnit(orgAContext, {
          projectId,
          unitNumber: "APT-BAD-CLASSIFICATION",
          usageType: "COMMERCIAL",
          unitType: "APARTMENT",
          grossArea: 120,
          price: 3000000,
        }),
      ).rejects.toThrow(
        "Usage type 'COMMERCIAL' conflicts with unit type 'APARTMENT'",
      );

      await expect(
        updateUnit(orgAContext, inferred.id, {
          usageType: "MEDICAL",
        }),
      ).rejects.toThrow(
        "Usage type 'MEDICAL' conflicts with unit type 'OFFICE'",
      );
    });

    it("should enforce unique unit_number constraint within the same project", async () => {
      await expect(
        createUnit(orgAContext, {
          projectId,
          unitNumber: "V-102", // Duplicate
          usageType: "RESIDENTIAL",
          unitType: "STANDALONE_VILLA",
          grossArea: 320.5,
          price: 8500000,
        }),
      ).rejects.toThrow();
    });

    it("should schedule a site visit and automatically update lead status and timeline", async () => {
      const visit = await scheduleVisit(orgAContext, {
        leadId,
        projectId,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        notes: "Interested in garden-facing villas",
      });

      expect(visit.id).toBeDefined();
      expect(visit.status).toBe("SCHEDULED");

      // Verify timeline activity logged
      const activities = await listLeadActivities(orgAContext, leadId);
      const visitActivity = activities.find(
        (a) => a.activity_type === "MEETING",
      );
      expect(visitActivity).toBeDefined();
      expect(visitActivity?.summary).toContain("Test Compound Alpha");

      // Update visit status to COMPLETED
      const updated = await updateVisitStatus(
        orgAContext,
        visit.id,
        "COMPLETED",
        "Buyer was highly impressed with construction progress",
      );
      expect(updated.status).toBe("COMPLETED");
      expect(updated.feedback).toContain("construction progress");
    });

    it("should place a reservation, lock unit availability, and prevent double-booking", async () => {
      const reservation = await createReservation(orgAContext, {
        leadId,
        unitId,
        depositAmount: 150000,
        currency: "EGP",
        expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(), // 3 days hold
        paymentMethod: "BANK_TRANSFER",
      });

      expect(reservation.id).toBeDefined();
      expect(reservation.status).toBe("CONFIRMED");

      // Verify Unit status changed to RESERVED
      const reservedUnit = await getUnit(orgAContext, unitId);
      expect(reservedUnit?.status).toBe("RESERVED");

      // Concurrency protection: Attempting to reserve the same unit must be strictly rejected
      await expect(
        createReservation(orgAContext, {
          leadId,
          unitId,
          depositAmount: 150000,
          expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        }),
      ).rejects.toThrow(UnitNotAvailableError);

      // Cancelling the reservation restores unit to AVAILABLE
      await cancelReservation(
        orgAContext,
        reservation.id,
        "Buyer switched to penthouse",
      );
      const restoredUnit = await getUnit(orgAContext, unitId);
      expect(restoredUnit?.status).toBe("AVAILABLE");
    });

    it("should execute a contract and permanently transition unit to CONTRACTED", async () => {
      // 1. Re-reserve the unit
      const res = await createReservation(orgAContext, {
        leadId,
        unitId,
        depositAmount: 200000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      // 2. Generate installment schedule
      const paymentPlan = generatePaymentSchedule({
        totalPrice: 8500000,
        downPaymentPercent: 10,
        installmentsYears: 5,
        frequency: "QUARTERLY",
        startDate: "2026-07-01",
      });

      // 3. Create executed Contract
      const contract = await createContract(orgAContext, {
        reservationId: res.id,
        leadId,
        unitId,
        contractNumber: "CNT-TEST-2026-001",
        contractValue: 8500000,
        currency: "EGP",
        paymentSchedule: paymentPlan.schedule,
        signedAt: new Date().toISOString(),
        status: "SIGNED",
      });

      expect(contract.id).toBeDefined();
      expect(contract.status).toBe("SIGNED");

      // 4. Verify Unit status permanently set to CONTRACTED
      const contractedUnit = await getUnit(orgAContext, unitId);
      expect(contractedUnit?.status).toBe("CONTRACTED");

      // 5. Verify Contract listed
      const contracts = await listContracts(orgAContext, { unitId });
      expect(contracts).toHaveLength(1);
      expect(contracts[0]?.contract_number).toBe("CNT-TEST-2026-001");

      // 6. Verify timeline activity logged
      const activities = await listLeadActivities(orgAContext, leadId);
      const contractNote = activities.find((a) =>
        a.summary.includes("executed for Unit #V-102"),
      );
      expect(contractNote).toBeDefined();
    });

    it("should strictly guarantee multi-tenant isolation across all real estate entities", async () => {
      // Tenant B queries projects, units, and contracts
      const foreignProjects = await listProjects(orgBContext);
      expect(foreignProjects).toHaveLength(0);

      const foreignUnits = await listUnits(orgBContext);
      expect(foreignUnits).toHaveLength(0);

      const foreignReservations = await listReservations(orgBContext);
      expect(foreignReservations).toHaveLength(0);

      const foreignVisits = await listVisits(orgBContext);
      expect(foreignVisits).toHaveLength(0);

      const foreignContracts = await listContracts(orgBContext);
      expect(foreignContracts).toHaveLength(0);
    });

    it("should support Phase 22 commercial project types, usage types, unit types, and read models", async () => {
      // 1. Create a Commercial Project (Commercial Alpha Complex)
      const commercialProject = await createProject(orgAContext, {
        name: "Commercial Alpha Complex",
        location: "Business District",
        projectType: "COMMERCIAL",
        constructionStatus: "UNDER_CONSTRUCTION",
        salesStatus: "SELLING",
        description: "Commercial retail, clinics, and offices center",
        isActive: true,
      });

      expect(commercialProject.project_type).toBe("COMMERCIAL");
      expect(commercialProject.construction_status).toBe("UNDER_CONSTRUCTION");
      expect(commercialProject.sales_status).toBe("SELLING");
      expect(commercialProject.is_active).toBe(true);

      // 2. Create Commercial Units (Clinic and Retail)
      const clinicUnit = await createUnit(orgAContext, {
        projectId: commercialProject.id,
        unitNumber: "CL-201",
        usageType: "MEDICAL",
        unitType: "CLINIC",
        modelName: "Executive Clinic",
        floor: "2nd Floor",
        grossArea: 65,
        price: 3250000,
        currency: "EGP",
      });

      expect(clinicUnit.usage_type).toBe("MEDICAL");
      expect(clinicUnit.unit_type).toBe("CLINIC");
      expect(clinicUnit.model_name).toBe("Executive Clinic");
      expect(clinicUnit.floor).toBe("2nd Floor");
      expect(clinicUnit.is_active).toBe(true);

      const retailUnit = await createUnit(orgAContext, {
        projectId: commercialProject.id,
        unitNumber: "RT-101",
        usageType: "COMMERCIAL",
        unitType: "RETAIL_STORE",
        modelName: "Corner Shop",
        floor: "Ground Floor",
        grossArea: 120,
        price: 9600000,
        currency: "EGP",
      });

      expect(retailUnit.usage_type).toBe("COMMERCIAL");
      expect(retailUnit.unit_type).toBe("RETAIL_STORE");
      expect(retailUnit.floor).toBe("Ground Floor");

      // 3. Test Read Models: listProjectsOverview includes new fields
      const overview = await listProjectsOverview(orgAContext);
      const mallOverview = overview.find((p) => p.id === commercialProject.id);
      expect(mallOverview).toBeDefined();
      expect(mallOverview?.project_type).toBe("COMMERCIAL");
      expect(mallOverview?.construction_status).toBe("UNDER_CONSTRUCTION");
      expect(mallOverview?.sales_status).toBe("SELLING");
      expect(mallOverview?.available_units).toBe(2);

      // 4. Test Read Models: listUnitsInventory with usageType and unitType filters
      const clinicInventory = await listUnitsInventory(orgAContext, {
        projectId: commercialProject.id,
        usageType: "MEDICAL",
        unitType: "CLINIC",
      });
      expect(clinicInventory.totalCount).toBe(1);
      expect(clinicInventory.units[0]?.unit_number).toBe("CL-201");
      expect(clinicInventory.units[0]?.usage_type).toBe("MEDICAL");
      expect(clinicInventory.units[0]?.unit_type).toBe("CLINIC");
      expect(clinicInventory.units[0]?.model_name).toBe("Executive Clinic");
      expect(clinicInventory.units[0]?.floor).toBe("2nd Floor");
    });

    it("should record 1:N property interests on leads, enforce check constraints, and deterministically match inventory", async () => {
      // Find the commercial project
      const allProjects = await listProjects(orgAContext);
      const mall = allProjects.find(
        (p) => p.name === "Commercial Alpha Complex",
      );
      expect(mall).toBeDefined();

      // Create a Lead without flat interest columns
      const clinicBuyer = await createLead(orgAContext, {
        fullName: "Dr. Karim Samy",
        phone: "01099887766",
        email: "karim.samy@medcare.com",
      });

      // 1. Add Primary Property Interest (1:N)
      const interest1 = await addLeadInterest(orgAContext, {
        leadId: clinicBuyer.id,
        projectId: mall!.id,
        usageType: "MEDICAL",
        unitType: "CLINIC",
        budgetMin: 3000000,
        budgetMax: 4000000,
        areaMin: 50,
        areaMax: 80,
        isPrimary: true,
        notes: "Needs front facade view",
      });

      expect(interest1.id).toBeDefined();
      expect(interest1.lead_id).toBe(clinicBuyer.id);
      expect(interest1.project_id).toBe(mall!.id);
      expect(interest1.usage_type).toBe("MEDICAL");
      expect(interest1.unit_type).toBe("CLINIC");
      expect(Number(interest1.budget_min)).toBe(3000000);
      expect(Number(interest1.budget_max)).toBe(4000000);
      expect(interest1.is_primary).toBe(true);

      await expect(
        addLeadInterest(orgAContext, {
          leadId: clinicBuyer.id,
          usageType: "COMMERCIAL",
          unitType: "CLINIC",
          isPrimary: false,
        }),
      ).rejects.toThrow(
        "Usage type 'COMMERCIAL' conflicts with unit type 'CLINIC'",
      );

      // 2. Add Secondary Property Interest (Wishlist 1:N)
      const interest2 = await addLeadInterest(orgAContext, {
        leadId: clinicBuyer.id,
        usageType: "COMMERCIAL",
        unitType: "RETAIL_STORE",
        budgetMin: 8000000,
        budgetMax: 12000000,
        areaMin: 100,
        areaMax: 150,
        isPrimary: false,
      });

      expect(interest2.id).toBeDefined();
      expect(interest2.is_primary).toBe(false);

      // 3. List 1:N Interests
      const leadInterests = await listLeadInterests(
        orgAContext,
        clinicBuyer.id,
      );
      expect(leadInterests).toHaveLength(2);

      // 4. Test Database CHECK Constraints on Budget and Area
      await expect(
        addLeadInterest(orgAContext, {
          leadId: clinicBuyer.id,
          budgetMin: 5000000,
          budgetMax: 3000000, // Inverted budget: min > max
        }),
      ).rejects.toThrow();

      await expect(
        addLeadInterest(orgAContext, {
          leadId: clinicBuyer.id,
          areaMin: 120,
          areaMax: 60, // Inverted area: min > max
        }),
      ).rejects.toThrow();

      // 5. Test Primary Active Demotion (Exactly one primary active interest per lead)
      const interest3 = await addLeadInterest(orgAContext, {
        leadId: clinicBuyer.id,
        usageType: "COMMERCIAL",
        unitType: "OFFICE",
        budgetMin: 2000000,
        budgetMax: 3500000,
        isPrimary: true, // Promoted to primary
      });
      expect(interest3.is_primary).toBe(true);

      const refreshedInterests = await listLeadInterests(
        orgAContext,
        clinicBuyer.id,
      );
      const primaryInterests = refreshedInterests.filter(
        (i) => i.is_primary && i.status === "ACTIVE",
      );
      expect(primaryInterests).toHaveLength(1);
      expect(primaryInterests[0]?.id).toBe(interest3.id);

      // Restore interest1 as primary for inventory matching test
      await updateLeadInterest(orgAContext, interest1.id, { isPrimary: true });

      // 6. Test Deterministic Inventory Matching Engine against 1:N interests
      const matches = await getLeadMatchedUnits(orgAContext, clinicBuyer.id);
      expect(matches.length).toBeGreaterThanOrEqual(1);

      // Top match must be CL-201 (Unit price 3.25M, area 65m², in Commercial Alpha Complex, unitType CLINIC)
      const topMatch = matches[0];
      expect(topMatch?.unit_number).toBe("CL-201");
      expect(topMatch?.matchScore).toBeGreaterThanOrEqual(70);
      expect(topMatch?.matchReasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Commercial Alpha Complex"),
          expect.stringContaining("CLINIC"),
          expect.stringContaining("budget"),
          expect.stringContaining("area"),
        ]),
      );

      // 7. Multi-Tenant Composite FK Protection: Tenant B cannot reference Tenant A's project or lead
      await expect(
        withTenantContext(orgBContext.organizationId, async (tx) => {
          await tx.query(
            `INSERT INTO lead_property_interests (organization_id, lead_id, project_id, is_primary)
             VALUES ($1, $2, $3, true)`,
            [orgBContext.organizationId, clinicBuyer.id, mall!.id],
          );
        }),
      ).rejects.toThrow(/violates foreign key constraint/);

      // Tenant B lead with matching criteria returns 0 units from Tenant A
      const foreignLead = await createLead(orgBContext, {
        fullName: "Foreign Buyer",
        phone: "01055555555",
      });
      await addLeadInterest(orgBContext, {
        leadId: foreignLead.id,
        usageType: "COMMERCIAL",
        unitType: "CLINIC",
        budgetMin: 3000000,
        budgetMax: 4000000,
        isPrimary: true,
      });

      const foreignMatches = await getLeadMatchedUnits(
        orgBContext,
        foreignLead.id,
      );
      expect(foreignMatches).toHaveLength(0);
    });

    it("should handle reservation concurrency, Just-In-Time expiration, and scheduled sweeper", async () => {
      // 1. Create a residential project & unit
      const residentialProject = await createProject(orgAContext, {
        name: "Residential Alpha Village",
        location: "East District",
        projectType: "RESIDENTIAL",
        constructionStatus: "UNDER_CONSTRUCTION",
        salesStatus: "SELLING",
      });

      const resUnit = await createUnit(orgAContext, {
        projectId: residentialProject.id,
        unitNumber: "SF-101",
        usageType: "RESIDENTIAL",
        unitType: "APARTMENT",
        floor: "1st",
        grossArea: 145,
        price: 2800000,
      });

      // 2. Lead 1 reserves the unit
      const res1 = await createReservation(orgAContext, {
        leadId,
        unitId: resUnit.id,
        depositAmount: 100000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(), // Valid hold
      });
      expect(res1.status).toBe("CONFIRMED");

      // Verify Unit is marked RESERVED
      const unitCheck = await getUnit(orgAContext, resUnit.id);
      expect(unitCheck?.status).toBe("RESERVED");

      // 3. Attempting double-booking while active must be strictly rejected
      const secondLead = await createLead(orgAContext, {
        fullName: "Second Potential Buyer",
        phone: "01044443333",
      });

      await expect(
        createReservation(orgAContext, {
          leadId: secondLead.id,
          unitId: resUnit.id,
          depositAmount: 100000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(UnitNotAvailableError);

      // 4. Protection A: Just-In-Time Expiration inside createReservation
      // Artificially simulate that res1 has passed its expiration time in DB
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          `UPDATE reservations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
          [res1.id],
        );
      });

      // Unit is still RESERVED in database prior to the next transaction
      const stillReserved = await getUnit(orgAContext, resUnit.id);
      expect(stillReserved?.status).toBe("RESERVED");

      // Second buyer attempts to reserve the unit. Just-In-Time logic will detect
      // the expired reservation, atomically transition it to EXPIRED, restore the unit,
      // and grant the new reservation cleanly!
      const res2 = await createReservation(orgAContext, {
        leadId: secondLead.id,
        unitId: resUnit.id,
        depositAmount: 120000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(res2.status).toBe("CONFIRMED");
      expect(res2.id).not.toBe(res1.id);

      // Verify res1 was transitioned to EXPIRED
      const oldReservations = await listReservations(orgAContext, {
        unitId: resUnit.id,
      });
      const oldRes = oldReservations.find((r) => r.id === res1.id);
      expect(oldRes?.status).toBe("EXPIRED");

      // 5. Protection B: Scheduled Sweeper (expireStaleReservations & sweepExpiredReservations)
      // Create another unit with an expired reservation
      const resUnit2 = await createUnit(orgAContext, {
        projectId: residentialProject.id,
        unitNumber: "SF-102",
        usageType: "RESIDENTIAL",
        unitType: "APARTMENT",
        floor: "2nd",
        grossArea: 160,
        price: 3200000,
      });

      const resStale = await createReservation(orgAContext, {
        leadId,
        unitId: resUnit2.id,
        depositAmount: 50000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      // Backdate expires_at to 2 hours ago
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          `UPDATE reservations SET expires_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
          [resStale.id],
        );
      });

      // Execute periodic sweeper
      const sweepResult = await expireStaleReservations(orgAContext);
      expect(sweepResult.expiredCount).toBeGreaterThanOrEqual(1);
      expect(sweepResult.expiredReservationIds).toContain(resStale.id);
      expect(sweepResult.restoredUnitIds).toContain(resUnit2.id);

      // Verify unit was restored to AVAILABLE
      const sweptUnit = await getUnit(orgAContext, resUnit2.id);
      expect(sweptUnit?.status).toBe("AVAILABLE");

      // Verify scheduled scanner runner integration
      const scheduledResult = await sweepExpiredReservations(orgAContext);
      expect(scheduledResult.jobType).toBe("RESERVATION_EXPIRATION_SWEEP");
    });

    it("should enforce Lead Property Interest and Matched Units authorization per role (Salesperson A vs B vs Marketing)", async () => {
      const sSuffix = `roles-${Date.now()}`;

      // 1. Create Salesperson A, Salesperson B, and Marketing User in Org A
      const userSalesA = await registerUser({
        email: `sales.a.${sSuffix}@prestige.com`,
        password: "Password123!",
        fullName: "Agent Alice",
      });
      const userSalesB = await registerUser({
        email: `sales.b.${sSuffix}@prestige.com`,
        password: "Password123!",
        fullName: "Agent Bob",
      });
      const userMarketing = await registerUser({
        email: `marketing.${sSuffix}@prestige.com`,
        password: "Password123!",
        fullName: "Marketing Mark",
      });

      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'SALESPERSON', true)",
          [orgAContext.organizationId, userSalesA.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'SALESPERSON', true)",
          [orgAContext.organizationId, userSalesB.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'MARKETING_USER', true)",
          [orgAContext.organizationId, userMarketing.id],
        );
      });

      const contextSalesA: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: userSalesA.id,
        role: "SALESPERSON",
        correlationId: `ctx-sales-a-${sSuffix}`,
      };

      const contextSalesB: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: userSalesB.id,
        role: "SALESPERSON",
        correlationId: `ctx-sales-b-${sSuffix}`,
      };

      const contextMarketing: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: userMarketing.id,
        role: "MARKETING_USER",
        correlationId: `ctx-mkt-${sSuffix}`,
      };

      // 2. Create Lead assigned to Agent Alice (Salesperson A)
      const leadA = await createLead(orgAContext, {
        fullName: "Alice's Client",
        phone: "01099998888",
        email: `client.alice.${sSuffix}@buyer.com`,
        assignedUserId: userSalesA.id,
      });

      // 3. Salesperson A can add interest to their own lead
      const interestA = await addLeadInterest(contextSalesA, {
        leadId: leadA.id,
        usageType: "RESIDENTIAL",
        unitType: "APARTMENT",
        budgetMin: 3000000,
        budgetMax: 5000000,
        isPrimary: true,
      });
      expect(interestA.id).toBeDefined();

      // Salesperson A can read and update interests on their own lead
      const listA = await listLeadInterests(contextSalesA, leadA.id);
      expect(listA).toHaveLength(1);

      const gotA = await getLeadInterest(contextSalesA, interestA.id);
      expect(gotA?.id).toBe(interestA.id);

      const updatedA = await updateLeadInterest(contextSalesA, interestA.id, {
        notes: "Updated by Alice",
      });
      expect(updatedA.notes).toBe("Updated by Alice");

      // 4. Salesperson B attempting to mutate or read Alice's lead's interest must throw ForbiddenError
      await expect(
        addLeadInterest(contextSalesB, {
          leadId: leadA.id,
          usageType: "COMMERCIAL",
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(listLeadInterests(contextSalesB, leadA.id)).rejects.toThrow(
        ForbiddenError,
      );

      await expect(
        getLeadInterest(contextSalesB, interestA.id),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        updateLeadInterest(contextSalesB, interestA.id, {
          notes: "Hacked by Bob",
        }),
      ).rejects.toThrow(ForbiddenError);

      // 5. Marketing User attempting to access or mutate individual lead interests must throw ForbiddenError
      await expect(
        addLeadInterest(contextMarketing, {
          leadId: leadA.id,
          usageType: "RESIDENTIAL",
        }),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        listLeadInterests(contextMarketing, leadA.id),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        getLeadInterest(contextMarketing, interestA.id),
      ).rejects.toThrow(ForbiddenError);

      // 6. getLeadMatchedUnits authorization
      // Salesperson A can probe matched units for their assigned lead
      const matchesAlice = await getLeadMatchedUnits(contextSalesA, leadA.id);
      expect(Array.isArray(matchesAlice)).toBe(true);

      // Salesperson B attempting to probe Alice's lead matched units must be rejected
      await expect(
        getLeadMatchedUnits(contextSalesB, leadA.id),
      ).rejects.toThrow(ForbiddenError);

      // Marketing User attempting to probe matched units must be rejected
      await expect(
        getLeadMatchedUnits(contextMarketing, leadA.id),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should enforce domain consistency for specific unit in lead property interests", async () => {
      // 1. Foreign unit from Org B
      const foreignProj = await createProject(orgBContext, {
        name: "Foreign Project B",
        location: "Abroad",
      });
      const foreignUnit = await createUnit(orgBContext, {
        projectId: foreignProj.id,
        unitNumber: "FOR-101",
        grossArea: 100,
        price: 2000000,
      });

      // Attempting to set specificUnitId from foreign tenant must fail
      await expect(
        addLeadInterest(orgAContext, {
          leadId,
          specificUnitId: foreignUnit.id,
        }),
      ).rejects.toThrow("not found in organization");

      // 2. Unit and project mismatch within same tenant
      const proj1 = await createProject(orgAContext, {
        name: "Project 1",
        location: "Loc 1",
      });
      const proj2 = await createProject(orgAContext, {
        name: "Project 2",
        location: "Loc 2",
      });
      const unitInProj1 = await createUnit(orgAContext, {
        projectId: proj1.id,
        unitNumber: "U-1-01",
        grossArea: 100,
        price: 2000000,
      });

      await expect(
        addLeadInterest(orgAContext, {
          leadId,
          projectId: proj2.id,
          specificUnitId: unitInProj1.id,
        }),
      ).rejects.toThrow("does not belong to project");
    });

    it("should enforce reservation authorization and ensure JIT expiration never reopens CONTRACTED or BLOCKED units", async () => {
      const testSuffix = `jit-safe-${Date.now()}`;

      // 1. Setup Salesperson A and B
      const userA = await registerUser({
        email: `agent.x.${testSuffix}@prestige.com`,
        password: "Password123!",
        fullName: "Agent X",
      });
      const userB = await registerUser({
        email: `agent.y.${testSuffix}@prestige.com`,
        password: "Password123!",
        fullName: "Agent Y",
      });

      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'SALESPERSON', true)",
          [orgAContext.organizationId, userA.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'SALESPERSON', true)",
          [orgAContext.organizationId, userB.id],
        );
      });

      const ctxA: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: userA.id,
        role: "SALESPERSON",
        correlationId: `ctx-x-${testSuffix}`,
      };
      const ctxB: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: userB.id,
        role: "SALESPERSON",
        correlationId: `ctx-y-${testSuffix}`,
      };

      const leadX = await createLead(orgAContext, {
        fullName: "Lead of Agent X",
        phone: "01088887777",
        assignedUserId: userA.id,
      });

      const jitProj = await createProject(orgAContext, {
        name: `JIT Safety Project ${testSuffix}`,
        location: "Sector 9",
      });

      const unitContracted = await createUnit(orgAContext, {
        projectId: jitProj.id,
        unitNumber: "CTR-UNIT-01",
        grossArea: 120,
        price: 3000000,
      });

      // Salesperson B cannot reserve for Agent X's lead
      await expect(
        createReservation(ctxB, {
          leadId: leadX.id,
          unitId: unitContracted.id,
          depositAmount: 50000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(ForbiddenError);

      // Agent X successfully reserves unitContracted
      const resX = await createReservation(ctxA, {
        leadId: leadX.id,
        unitId: unitContracted.id,
        depositAmount: 50000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(resX.status).toBe("CONFIRMED");

      // Deal progresses to CONTRACTED
      await createContract(orgAContext, {
        reservationId: resX.id,
        unitId: unitContracted.id,
        leadId: leadX.id,
        contractNumber: `CTR-SAFE-${testSuffix.toUpperCase()}`,
        contractValue: 3000000,
        status: "SIGNED",
      });

      // Simulate reservation expiration in DB
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          `UPDATE reservations SET expires_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
          [resX.id],
        );
      });

      // Verify unit is currently CONTRACTED
      const unitBeforeJIT = await getUnit(orgAContext, unitContracted.id);
      expect(unitBeforeJIT?.status).toBe("CONTRACTED");

      // Attempting to reserve this unit now must:
      // 1. Expire the stale reservation
      // 2. REFUSE to restore unit status to AVAILABLE
      // 3. Throw UnitNotAvailableError
      const leadNew = await createLead(orgAContext, {
        fullName: "Another Buyer",
        phone: "01077776666",
      });

      await expect(
        createReservation(orgAContext, {
          leadId: leadNew.id,
          unitId: unitContracted.id,
          depositAmount: 50000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(UnitNotAvailableError);

      // Unit status MUST STILL BE CONTRACTED!
      const unitAfterJIT = await getUnit(orgAContext, unitContracted.id);
      expect(unitAfterJIT?.status).toBe("CONTRACTED");

      // BLOCKED Unit Test:
      const unitBlocked = await createUnit(orgAContext, {
        projectId: jitProj.id,
        unitNumber: "BLK-UNIT-02",
        grossArea: 110,
        price: 2500000,
      });

      const resBlocked = await createReservation(orgAContext, {
        leadId: leadNew.id,
        unitId: unitBlocked.id,
        depositAmount: 30000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      // Set unit status to BLOCKED and backdate reservation expiration
      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(`UPDATE units SET status = 'BLOCKED' WHERE id = $1`, [
          unitBlocked.id,
        ]);
        await tx.query(
          `UPDATE reservations SET expires_at = NOW() - INTERVAL '3 hours' WHERE id = $1`,
          [resBlocked.id],
        );
      });

      // Attempting to reserve BLOCKED unit must throw UnitNotAvailableError and NOT reopen unit
      await expect(
        createReservation(orgAContext, {
          leadId,
          unitId: unitBlocked.id,
          depositAmount: 40000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(UnitNotAvailableError);

      const unitBlockedAfter = await getUnit(orgAContext, unitBlocked.id);
      expect(unitBlockedAfter?.status).toBe("BLOCKED");
    });

    it("should guarantee deadlock safety under concurrent reservations and expiration sweeps", async () => {
      const concSuffix = `dl-${Date.now()}`;
      const project = await createProject(orgAContext, {
        name: `Deadlock Test Project ${concSuffix}`,
        location: "Cluster X",
      });

      // Create 3 units with expired reservations
      const unitIds: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const u = await createUnit(orgAContext, {
          projectId: project.id,
          unitNumber: `CONC-${i}`,
          grossArea: 100 + i * 10,
          price: 2000000 + i * 100000,
        });
        unitIds.push(u.id);

        const r = await createReservation(orgAContext, {
          leadId,
          unitId: u.id,
          depositAmount: 20000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });

        await withTenantContext(orgAContext.organizationId, async (tx) => {
          await tx.query(
            `UPDATE reservations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
            [r.id],
          );
        });
      }

      // Create buyers
      const buyers = await Promise.all([
        createLead(orgAContext, {
          fullName: "Concurrent Buyer 1",
          phone: "0100001",
        }),
        createLead(orgAContext, {
          fullName: "Concurrent Buyer 2",
          phone: "0100002",
        }),
        createLead(orgAContext, {
          fullName: "Concurrent Buyer 3",
          phone: "0100003",
        }),
      ]);

      // Fire concurrent createReservation and expireStaleReservations calls simultaneously
      const operations = [
        expireStaleReservations(orgAContext),
        createReservation(orgAContext, {
          leadId: buyers[0]!.id,
          unitId: unitIds[0]!,
          depositAmount: 50000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }).catch((e) => e),
        createReservation(orgAContext, {
          leadId: buyers[1]!.id,
          unitId: unitIds[1]!,
          depositAmount: 50000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }).catch((e) => e),
        expireStaleReservations(orgAContext),
        createReservation(orgAContext, {
          leadId: buyers[2]!.id,
          unitId: unitIds[2]!,
          depositAmount: 50000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }).catch((e) => e),
      ];

      const results = await Promise.all(operations);

      // Verify that NO database deadlock (error code 40P01) occurred in any operation
      for (const res of results) {
        if (res instanceof Error) {
          expect((res as any).code).not.toBe("40P01");
        }
      }
    });

    it("should scope reservation lists by salesperson assignment and enforce read permission", async () => {
      const suffix = `reservation-list-${Date.now()}`;
      const salesA = await registerUser({
        email: `ra.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Agent A",
      });
      const salesB = await registerUser({
        email: `rb.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Agent B",
      });
      const manager = await registerUser({
        email: `rm.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Manager",
      });
      const marketing = await registerUser({
        email: `mk.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Marketing",
      });

      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          "INSERT INTO organization_memberships (organization_id,user_id,role,is_active) VALUES ($1,$2,'SALESPERSON',true)",
          [orgAContext.organizationId, salesA.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id,user_id,role,is_active) VALUES ($1,$2,'SALESPERSON',true)",
          [orgAContext.organizationId, salesB.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id,user_id,role,is_active) VALUES ($1,$2,'SALES_MANAGER',true)",
          [orgAContext.organizationId, manager.id],
        );
        await tx.query(
          "INSERT INTO organization_memberships (organization_id,user_id,role,is_active) VALUES ($1,$2,'MARKETING_USER',true)",
          [orgAContext.organizationId, marketing.id],
        );
      });

      const ctxA: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: salesA.id,
        role: "SALESPERSON",
        correlationId: `${suffix}a`,
      };
      const ctxB: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: salesB.id,
        role: "SALESPERSON",
        correlationId: `${suffix}b`,
      };
      const ctxM: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: manager.id,
        role: "SALES_MANAGER",
        correlationId: `${suffix}m`,
      };
      const ctxMarketing: TenantContext = {
        organizationId: orgAContext.organizationId,
        userId: marketing.id,
        role: "MARKETING_USER",
        correlationId: `${suffix}mk`,
      };

      const leadA = await createLead(orgAContext, {
        fullName: "Lead A",
        phone: `0101${Date.now().toString().slice(-7)}`,
        assignedUserId: salesA.id,
      });
      const leadB = await createLead(orgAContext, {
        fullName: "Lead B",
        phone: `0102${Date.now().toString().slice(-7)}`,
        assignedUserId: salesB.id,
      });
      const project = await createProject(orgAContext, {
        name: `Visibility ${suffix}`,
        location: "Test",
      });
      const unitA = await createUnit(orgAContext, {
        projectId: project.id,
        unitNumber: `VA-${suffix}`,
        grossArea: 100,
        price: 1000000,
      });
      const unitB = await createUnit(orgAContext, {
        projectId: project.id,
        unitNumber: `VB-${suffix}`,
        grossArea: 110,
        price: 1100000,
      });

      const reservationA = await createReservation(ctxA, {
        leadId: leadA.id,
        unitId: unitA.id,
        depositAmount: 10000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      const reservationB = await createReservation(ctxB, {
        leadId: leadB.id,
        unitId: unitB.id,
        depositAmount: 10000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect((await listReservations(ctxA)).map((r) => r.id)).toContain(
        reservationA.id,
      );
      expect((await listReservations(ctxA)).map((r) => r.id)).not.toContain(
        reservationB.id,
      );
      expect((await listReservations(ctxB)).map((r) => r.id)).toContain(
        reservationB.id,
      );
      expect((await listReservations(ctxB)).map((r) => r.id)).not.toContain(
        reservationA.id,
      );
      expect((await listReservations(ctxM)).map((r) => r.id)).toEqual(
        expect.arrayContaining([reservationA.id, reservationB.id]),
      );
      await expect(listReservations(ctxMarketing)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("should avoid deadlocks when cancel races with create and sweep", async () => {
      const suffix = `cancel-race-${Date.now()}`;
      const project = await createProject(orgAContext, {
        name: `Cancel Race ${suffix}`,
        location: "Test",
      });
      const unit = await createUnit(orgAContext, {
        projectId: project.id,
        unitNumber: `CR-${suffix}`,
        grossArea: 120,
        price: 2000000,
      });
      const leadOne = await createLead(orgAContext, {
        fullName: "Race One",
        phone: `0111${Date.now().toString().slice(-7)}`,
      });
      const leadTwo = await createLead(orgAContext, {
        fullName: "Race Two",
        phone: `0112${Date.now().toString().slice(-7)}`,
      });
      const reservation = await createReservation(orgAContext, {
        leadId: leadOne.id,
        unitId: unit.id,
        depositAmount: 10000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const results = await Promise.all([
        cancelReservation(orgAContext, reservation.id, "race").catch(
          (error) => error,
        ),
        createReservation(orgAContext, {
          leadId: leadTwo.id,
          unitId: unit.id,
          depositAmount: 12000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }).catch((error) => error),
        expireStaleReservations(orgAContext).catch((error) => error),
      ]);

      for (const result of results) {
        if (result instanceof Error) {
          expect((result as { code?: string }).code).not.toBe("40P01");
        }
      }

      const active = (
        await listReservations(orgAContext, { unitId: unit.id })
      ).filter((item) => ["CONFIRMED", "PENDING"].includes(item.status));
      expect(active.length).toBeLessThanOrEqual(1);
      expect((await getUnit(orgAContext, unit.id))?.status).toBe(
        active.length === 1 ? "RESERVED" : "AVAILABLE",
      );
    });

    it("should avoid deadlocks when cancel races with expiration sweeping", async () => {
      const suffix = `cancel-sweep-${Date.now()}`;
      const project = await createProject(orgAContext, {
        name: `Cancel Sweep ${suffix}`,
        location: "Test",
      });
      const unit = await createUnit(orgAContext, {
        projectId: project.id,
        unitNumber: `CS-${suffix}`,
        grossArea: 125,
        price: 2100000,
      });
      const lead = await createLead(orgAContext, {
        fullName: "Sweep Buyer",
        phone: `0121${Date.now().toString().slice(-7)}`,
      });
      const reservation = await createReservation(orgAContext, {
        leadId: lead.id,
        unitId: unit.id,
        depositAmount: 10000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      await withTenantContext(orgAContext.organizationId, async (tx) => {
        await tx.query(
          "UPDATE reservations SET expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1",
          [reservation.id],
        );
      });

      const results = await Promise.all([
        cancelReservation(orgAContext, reservation.id, "sweep race").catch(
          (error) => error,
        ),
        expireStaleReservations(orgAContext).catch((error) => error),
      ]);

      for (const result of results) {
        if (result instanceof Error) {
          expect((result as { code?: string }).code).not.toBe("40P01");
        }
      }

      const finalReservations = await listReservations(orgAContext, {
        unitId: unit.id,
      });
      expect(["CANCELLED", "EXPIRED"]).toContain(finalReservations[0]!.status);
      expect((await getUnit(orgAContext, unit.id))?.status).toBe("AVAILABLE");
    });
  });
});
