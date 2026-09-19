import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  inviteMember,
  createLead,
  createProject,
  createUnit,
  createReservation,
  createTask,
  createRule,
  scanInactivityExceededLeads,
  scanExpiringReservations,
  scanDueTasks,
  runAllScheduledScanners,
} from "../packages/core/src/index.js";

describe("Phase 12: Inactivity & Time-based Triggers Engine (Live Tests)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  let managerAId: string;
  let staleLeadId: string;
  let freshLeadId: string;

  let expiringResId: string;
  let safeResId: string;

  let overdueTaskId: string;
  let futureTaskId: string;

  beforeAll(async () => {
    // 1. Setup Org A (Orascom Development)
    const ownerA = await registerUser({
      email: `owner.orascom.${uniqueSuffix}@orascom.local`,
      password: "StrongPassword2026!",
      fullName: "Samih Sawiris",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Orascom Development ${uniqueSuffix}`,
      slug: `orascom-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `test-sla-org-a-${uniqueSuffix}`,
    };

    const managerA = await inviteMember(orgAContext, {
      email: `manager.${uniqueSuffix}@orascom.local`,
      fullName: "Tarek Sales Director",
      role: "SALES_MANAGER",
    });
    managerAId = managerA.userId;

    // 3. Setup Org B (Madinet Nasr)
    const ownerB = await registerUser({
      email: `owner.mn.${uniqueSuffix}@mn.local`,
      password: "StrongPassword2026!",
      fullName: "Abdallah Sallam",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Madinet Masr ${uniqueSuffix}`,
      slug: `mn-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `test-sla-org-b-${uniqueSuffix}`,
    };

    // 4. Seed Data in Org A
    // Fresh Lead (created now)
    const freshLead = await createLead(orgAContext, {
      fullName: "أحمد فريش",
      phone: `+2010111111${uniqueSuffix.slice(0, 2)}`,
    });
    freshLeadId = freshLead.id;

    // Stale Lead (simulated created 36 hours ago)
    const staleLead = await createLead(orgAContext, {
      fullName: "محمود خامل (مهمل)",
      phone: `+2010222222${uniqueSuffix.slice(0, 2)}`,
    });
    staleLeadId = staleLead.id;

    await withTenantContext(orgAContext.organizationId, async (tx) => {
      await tx.query(
        `UPDATE leads SET created_at = NOW() - INTERVAL '36 hours', last_contacted_at = NULL WHERE id = $1`,
        [staleLeadId],
      );
    });

    // Real Estate Units & Reservations
    const project = await createProject(orgAContext, {
      name: `El Gouna Fanadir ${uniqueSuffix}`,
      location: "Red Sea, Egypt",
    });

    const unit1 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "V-201",
      unitType: "VILLA",
      price: 25000000,
      grossArea: 350,
    });

    const unit2 = await createUnit(orgAContext, {
      projectId: project.id,
      unitNumber: "V-202",
      unitType: "VILLA",
      price: 30000000,
      grossArea: 420,
    });

    // Reservation Leads (separate from staleLead to keep staleLead status as NEW)
    const buyerLead1 = await createLead(orgAContext, {
      fullName: "مشتري حجز 1",
      phone: `+2010333333${uniqueSuffix.slice(0, 2)}`,
    });
    const buyerLead2 = await createLead(orgAContext, {
      fullName: "مشتري حجز 2",
      phone: `+2010444444${uniqueSuffix.slice(0, 2)}`,
    });

    // Reservation expiring in 12 hours
    const r1 = await createReservation(orgAContext, {
      leadId: buyerLead1.id,
      unitId: unit1.id,
      depositAmount: 500000,
      expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
    expiringResId = r1.id;

    await withTenantContext(orgAContext.organizationId, async (tx) => {
      await tx.query(
        `UPDATE reservations SET expires_at = NOW() + INTERVAL '12 hours' WHERE id = $1`,
        [expiringResId],
      );
    });

    // Reservation safe (expires in 5 days)
    const r2 = await createReservation(orgAContext, {
      leadId: buyerLead2.id,
      unitId: unit2.id,
      depositAmount: 500000,
      expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    });
    safeResId = r2.id;

    // Overdue Task & Future Task
    const t1 = await createTask(orgAContext, {
      leadId: staleLeadId,
      assignedUserId: managerAId,
      title: "Overdue Inspection Call",
      dueDate: new Date(Date.now() - 3600000 * 3).toISOString(), // 3 hours ago
    });
    overdueTaskId = t1.id;

    const t2 = await createTask(orgAContext, {
      leadId: freshLeadId,
      assignedUserId: managerAId,
      title: "Future Follow-up",
      dueDate: new Date(Date.now() + 3600000 * 24).toISOString(), // 24 hours later
    });
    futureTaskId = t2.id;
  });

  describe("1. Stale Lead Inactivity Detection & SLA Escalation", () => {
    it("fires lead.inactivity_exceeded rule, changes status to ESCALATED and reassigns to manager", async () => {
      // 1. Create Smart Rule
      await createRule(orgAContext, {
        name: "SLA Escalation: Inactive Leads for 24+ Hours",
        trigger_type: "lead.inactivity_exceeded",
        conditions: [
          {
            field: "status",
            operator: "equals",
            value: "NEW",
          },
        ],
        actions: [
          {
            action_type: "lead.change_status",
            params: { status: "ESCALATED" },
            delay_seconds: 0,
          },
          {
            action_type: "lead.assign_specific_user",
            params: { user_id: managerAId },
            delay_seconds: 0,
          },
        ],
      });

      // 2. Run Scanner (24 hours threshold)
      const res = await scanInactivityExceededLeads(orgAContext, 24);

      expect(res.entitiesEvaluated).toBe(1); // Only stale lead
      expect(res.rulesTriggered).toBe(1);
      expect(res.details[0].entityId).toBe(staleLeadId);

      // 3. Verify Database Changes
      const updatedLead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const r = await tx.query("SELECT * FROM leads WHERE id = $1", [
            staleLeadId,
          ]);
          return r.rows[0];
        },
      );

      expect(updatedLead.status).toBe("ESCALATED");
      expect(updatedLead.assigned_user_id).toBe(managerAId);

      // Verify Fresh Lead was NOT modified
      const untouchedLead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const r = await tx.query("SELECT * FROM leads WHERE id = $1", [
            freshLeadId,
          ]);
          return r.rows[0];
        },
      );
      expect(untouchedLead.status).toBe("NEW");
    });
  });

  describe("2. Expiring Unit Reservations Monitor", () => {
    it("detects reservations expiring within 24h window and logs internal alert", async () => {
      // 1. Create Rule
      await createRule(orgAContext, {
        name: "Reservation Expiration Warning",
        trigger_type: "reservation.expiring",
        conditions: [],
        actions: [
          {
            action_type: "notification.internal",
            params: { summary: "Urgent: Reservation hold expiring soon" },
            delay_seconds: 0,
          },
        ],
      });

      // 2. Run Scanner
      const res = await scanExpiringReservations(orgAContext, 24);

      expect(res.entitiesEvaluated).toBe(1);
      expect(res.details[0].entityId).toBe(expiringResId);
      expect(res.rulesTriggered).toBe(1);
    });
  });

  describe("3. Overdue Task Monitoring", () => {
    it("detects overdue tasks and logs notification activity", async () => {
      // 1. Create Rule
      await createRule(orgAContext, {
        name: "Overdue Task Alert",
        trigger_type: "task.due",
        conditions: [
          {
            field: "is_completed",
            operator: "equals",
            value: false,
          },
        ],
        actions: [
          {
            action_type: "notification.internal",
            params: { summary: "Task SLA breached: Overdue deadline" },
            delay_seconds: 0,
          },
        ],
      });

      // 2. Run Scanner
      const res = await scanDueTasks(orgAContext);

      expect(res.entitiesEvaluated).toBe(1);
      expect(res.details[0].entityId).toBe(overdueTaskId);
      expect(res.rulesTriggered).toBe(1);
    });
  });

  describe("4. Master Scheduled Scanner & Audit Logging", () => {
    it("executes runAllScheduledScanners and logs job execution in scheduled_job_runs", async () => {
      const results = await runAllScheduledScanners(orgAContext);
      expect(results).toHaveLength(3);

      // Verify scheduled_job_runs table
      const runs = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const r = await tx.query(
            "SELECT * FROM scheduled_job_runs WHERE organization_id = $1 ORDER BY started_at DESC",
            [orgAContext.organizationId],
          );
          return r.rows;
        },
      );

      expect(runs.length).toBeGreaterThanOrEqual(3);
      expect(runs[0].status).toBe("COMPLETED");
    });
  });

  describe("5. Multi-Tenant Isolation (Zero Leak Invariant)", () => {
    it("ensures Org B scanners evaluate 0 records and cannot view Org A scheduled runs", async () => {
      const orgBRes = await scanInactivityExceededLeads(orgBContext, 24);
      expect(orgBRes.entitiesEvaluated).toBe(0);
      expect(orgBRes.rulesTriggered).toBe(0);

      const orgBRuns = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const r = await tx.query("SELECT * FROM scheduled_job_runs");
          return r.rows;
        },
      );

      // Org B only sees its own scheduled runs (from the scan above)
      expect(
        orgBRuns.every(
          (run) => run.organization_id === orgBContext.organizationId,
        ),
      ).toBe(true);
    });
  });
});
