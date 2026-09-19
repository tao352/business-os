import { describe, it, expect, beforeAll } from 'vitest';
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
  UnitNotAvailableError,
  createContract,
  signContract,
  listContracts,
  registerUser,
  createOrganization,
  createLead,
  listLeadActivities,
} from '../packages/core/src/index.js';
import type { TenantContext } from '@business-os/types';

describe('Phase 7: Real Estate Vertical Template (النواة العقارية)', () => {
  describe('Unit: Mathematical Payment Plan & Installments Generator', () => {
    it('should generate an exact quarterly payment schedule for 5,000,000 EGP over 5 years', () => {
      const schedule = generatePaymentSchedule({
        totalPrice: 5000000,
        downPaymentPercent: 10,
        installmentsYears: 5,
        frequency: 'QUARTERLY',
        deliveryPaymentPercent: 10,
        deliveryDate: '2029-06-30',
        startDate: '2026-06-01',
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
        .filter((item) => item.type !== 'MAINTENANCE')
        .reduce((sum, item) => sum + item.amount, 0);

      expect(principalSum).toBe(5000000);

      // Verify date steps (every 3 months)
      const firstInstallment = schedule.schedule.find((s) => s.installmentNumber === 2);
      expect(firstInstallment?.dueDate).toBe('2026-09-01');
    });

    it('should prevent decimal rounding drift on irregular prices and monthly installments', () => {
      const schedule = generatePaymentSchedule({
        totalPrice: 1333333.33,
        downPaymentPercent: 15,
        installmentsYears: 3,
        frequency: 'MONTHLY',
        startDate: '2026-01-01',
      });

      expect(schedule.installmentsCount).toBe(36);

      const principalSum = schedule.schedule
        .filter((item) => item.type !== 'MAINTENANCE')
        .reduce((sum, item) => sum + item.amount, 0);

      // Difference must be precisely 0 to the cent
      expect(Math.abs(principalSum - 1333333.33)).toBeLessThan(0.01);
    });
  });

  describe('Integration: Real Estate Vertical Workflow & Multi-Tenancy', () => {
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
        password: 'Password123!',
        fullName: 'Real Estate Developer',
      });
      const orgA = await createOrganization({
        userId: userA.id,
        name: `Prestige Developments ${suffix}`,
        slug: `prestige-${suffix}`,
      });
      orgAContext = {
        organizationId: orgA.id,
        userId: userA.id,
        role: 'OWNER',
        correlationId: `corr-re-${suffix}`,
      };

      // Tenant B (Foreign)
      const userB = await registerUser({
        email: `rival.re.${suffix}@test.com`,
        password: 'Password123!',
        fullName: 'Rival Developer',
      });
      const orgB = await createOrganization({
        userId: userB.id,
        name: `Rival Real Estate ${suffix}`,
        slug: `rival-${suffix}`,
      });
      orgBContext = {
        organizationId: orgB.id,
        userId: userB.id,
        role: 'OWNER',
        correlationId: `corr-rival-${suffix}`,
      };

      // Create a Lead in Tenant A
      const lead = await createLead(orgAContext, {
        fullName: 'Youssef El-Sherif',
        phone: '01012345678',
        email: 'youssef@buyer.com',
      });
      leadId = lead.id;
    });

    it('should create and manage projects with total_units tracking', async () => {
      const project = await createProject(orgAContext, {
        name: 'Zayed Horizon',
        location: 'Sheikh Zayed, Green Belt',
        description: 'Boutique luxury compound with private villas',
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Zayed Horizon');
      expect(project.total_units).toBe(0);
      projectId = project.id;

      const fetched = await getProject(orgAContext, projectId);
      expect(fetched?.name).toBe('Zayed Horizon');

      const allProjects = await listProjects(orgAContext);
      expect(allProjects.some((p) => p.id === projectId)).toBe(true);
    });

    it('should create units and automatically increment project total_units', async () => {
      const unit = await createUnit(orgAContext, {
        projectId,
        unitNumber: 'V-102',
        unitType: 'Standalone Villa',
        grossArea: 320.5,
        price: 8500000,
        currency: 'EGP',
        paymentPlanTemplate: {
          downPayment: 10,
          years: 7,
          frequency: 'QUARTERLY',
        },
      });

      expect(unit.id).toBeDefined();
      expect(unit.unit_number).toBe('V-102');
      expect(unit.status).toBe('AVAILABLE');
      unitId = unit.id;

      // Check project total_units was incremented to 1
      const project = await getProject(orgAContext, projectId);
      expect(project?.total_units).toBe(1);

      // Verify list units
      const units = await listUnits(orgAContext, { projectId, status: 'AVAILABLE' });
      expect(units).toHaveLength(1);
      expect(units[0]?.unit_number).toBe('V-102');
    });

    it('should enforce unique unit_number constraint within the same project', async () => {
      await expect(
        createUnit(orgAContext, {
          projectId,
          unitNumber: 'V-102', // Duplicate
          unitType: 'Standalone Villa',
          grossArea: 320.5,
          price: 8500000,
        })
      ).rejects.toThrow();
    });

    it('should schedule a site visit and automatically update lead status and timeline', async () => {
      const visit = await scheduleVisit(orgAContext, {
        leadId,
        projectId,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        notes: 'Interested in garden-facing villas',
      });

      expect(visit.id).toBeDefined();
      expect(visit.status).toBe('SCHEDULED');

      // Verify timeline activity logged
      const activities = await listLeadActivities(orgAContext, leadId);
      const visitActivity = activities.find((a) => a.activity_type === 'MEETING');
      expect(visitActivity).toBeDefined();
      expect(visitActivity?.summary).toContain('Zayed Horizon');

      // Update visit status to COMPLETED
      const updated = await updateVisitStatus(
        orgAContext,
        visit.id,
        'COMPLETED',
        'Buyer was highly impressed with construction progress'
      );
      expect(updated.status).toBe('COMPLETED');
      expect(updated.feedback).toContain('construction progress');
    });

    it('should place a reservation, lock unit availability, and prevent double-booking', async () => {
      const reservation = await createReservation(orgAContext, {
        leadId,
        unitId,
        depositAmount: 150000,
        currency: 'EGP',
        expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(), // 3 days hold
        paymentMethod: 'BANK_TRANSFER',
      });

      expect(reservation.id).toBeDefined();
      expect(reservation.status).toBe('CONFIRMED');

      // Verify Unit status changed to RESERVED
      const reservedUnit = await getUnit(orgAContext, unitId);
      expect(reservedUnit?.status).toBe('RESERVED');

      // Concurrency protection: Attempting to reserve the same unit must be strictly rejected
      await expect(
        createReservation(orgAContext, {
          leadId,
          unitId,
          depositAmount: 150000,
          expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        })
      ).rejects.toThrow(UnitNotAvailableError);

      // Cancelling the reservation restores unit to AVAILABLE
      await cancelReservation(orgAContext, reservation.id, 'Buyer switched to penthouse');
      const restoredUnit = await getUnit(orgAContext, unitId);
      expect(restoredUnit?.status).toBe('AVAILABLE');
    });

    it('should execute a contract and permanently transition unit to CONTRACTED', async () => {
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
        frequency: 'QUARTERLY',
        startDate: '2026-07-01',
      });

      // 3. Create executed Contract
      const contract = await createContract(orgAContext, {
        reservationId: res.id,
        leadId,
        unitId,
        contractNumber: 'CNT-ZH-2026-001',
        contractValue: 8500000,
        currency: 'EGP',
        paymentSchedule: paymentPlan.schedule,
        signedAt: new Date().toISOString(),
        status: 'SIGNED',
      });

      expect(contract.id).toBeDefined();
      expect(contract.status).toBe('SIGNED');

      // 4. Verify Unit status permanently set to CONTRACTED
      const contractedUnit = await getUnit(orgAContext, unitId);
      expect(contractedUnit?.status).toBe('CONTRACTED');

      // 5. Verify Contract listed
      const contracts = await listContracts(orgAContext, { unitId });
      expect(contracts).toHaveLength(1);
      expect(contracts[0]?.contract_number).toBe('CNT-ZH-2026-001');

      // 6. Verify timeline activity logged
      const activities = await listLeadActivities(orgAContext, leadId);
      const contractNote = activities.find((a) => a.summary.includes('executed for Unit #V-102'));
      expect(contractNote).toBeDefined();
    });

    it('should strictly guarantee multi-tenant isolation across all real estate entities', async () => {
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
  });
});
