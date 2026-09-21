import { describe, it, expect, beforeAll } from "vitest";
import {
  generatePaymentSchedule,
  createProject,
  getProject,
  listProjects,
  createUnit,
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
  updateLeadInterest,
  listProjectsOverview,
  listUnitsInventory,
  getLeadMatchedUnits,
} from "../packages/core/src/index.js";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";

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
        isActive: true,
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Test Compound Alpha");
      expect(project.project_type).toBe("RESIDENTIAL");
      expect(project.construction_status).toBe("PLANNING");
      expect(project.sales_status).toBe("UPCOMING");
      expect(project.is_active).toBe(true);
      expect(project.total_units).toBe(0);
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

      // Check project total_units was incremented to 1
      const project = await getProject(orgAContext, projectId);
      expect(project?.total_units).toBe(1);

      // Verify list units
      const units = await listUnits(orgAContext, {
        projectId,
        status: "AVAILABLE",
      });
      expect(units).toHaveLength(1);
      expect(units[0]?.unit_number).toBe("V-102");
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
        usageType: "COMMERCIAL",
        unitType: "CLINIC",
        modelName: "Executive Clinic",
        floor: "2nd Floor",
        grossArea: 65,
        price: 3250000,
        currency: "EGP",
      });

      expect(clinicUnit.usage_type).toBe("COMMERCIAL");
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
        usageType: "COMMERCIAL",
        unitType: "CLINIC",
      });
      expect(clinicInventory.totalCount).toBe(1);
      expect(clinicInventory.units[0]?.unit_number).toBe("CL-201");
      expect(clinicInventory.units[0]?.usage_type).toBe("COMMERCIAL");
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
        usageType: "COMMERCIAL",
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
      expect(interest1.usage_type).toBe("COMMERCIAL");
      expect(interest1.unit_type).toBe("CLINIC");
      expect(Number(interest1.budget_min)).toBe(3000000);
      expect(Number(interest1.budget_max)).toBe(4000000);
      expect(interest1.is_primary).toBe(true);

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
  });
});
