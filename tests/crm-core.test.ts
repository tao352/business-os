import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  inviteMember,
  createLead,
  getLead,
  listLeads,
  updateLeadStatus,
  assignLead,
  logActivity,
  listLeadActivities,
  createTask,
  listTasks,
  completeTask,
  createDeal,
  updateDealStage,
  listDeals,
  ForbiddenError,
} from "../packages/core/src/index.js";

describe("Live CRM Core Engine (Leads, Activities, Tasks, Deals & Auditing)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let organizationId: string;

  let ownerContext: TenantContext;
  let managerContext: TenantContext;
  let agentAContext: TenantContext;
  let agentBContext: TenantContext;

  let createdLeadId: string;

  beforeAll(async () => {
    // 1. Setup Organization & Owner
    const owner = await registerUser({
      email: `owner.${uniqueSuffix}@marassi.local`,
      password: "OwnerPassword2026!",
      fullName: "Hassan Marassi",
    });

    const org = await createOrganization({
      userId: owner.id,
      name: "Marassi Heights Development",
      slug: `marassi-${uniqueSuffix}`,
    });
    organizationId = org.id;

    ownerContext = {
      organizationId,
      userId: owner.id,
      role: "OWNER",
      correlationId: "req-owner-1",
    };

    // 3. Setup Sales Manager
    const manager = await inviteMember(ownerContext, {
      email: `manager.${uniqueSuffix}@marassi.local`,
      role: "SALES_MANAGER",
      fullName: "Karim Manager",
    });
    managerContext = {
      organizationId,
      userId: manager.userId,
      role: "SALES_MANAGER",
      correlationId: "req-manager-1",
    };

    // 4. Setup Salesperson A
    const agentA = await inviteMember(ownerContext, {
      email: `agent.a.${uniqueSuffix}@marassi.local`,
      role: "SALESPERSON",
      fullName: "Ahmed Agent A",
    });
    agentAContext = {
      organizationId,
      userId: agentA.userId,
      role: "SALESPERSON",
      correlationId: "req-agent-a",
    };

    // 5. Setup Salesperson B
    const agentB = await inviteMember(ownerContext, {
      email: `agent.b.${uniqueSuffix}@marassi.local`,
      role: "SALESPERSON",
      fullName: "Youssef Agent B",
    });
    agentBContext = {
      organizationId,
      userId: agentB.userId,
      role: "SALESPERSON",
      correlationId: "req-agent-b",
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("Lead Creation & Automatic Audit/Timeline Logging", () => {
    it("creates a new lead, logs an immutable audit record, and initializes timeline", async () => {
      const lead = await createLead(ownerContext, {
        fullName: "Dr. Mahmoud El-Sayed",
        phone: "+201011112222",
        email: "mahmoud.buyer@gmail.com",
        source: "META_LEAD_ADS",
        campaignId: "cmp_summer_villas_2026",
        customData: {
          budget: 5500000,
          unit_type_interest: "Twin House",
        },
      });

      expect(lead.id).toBeDefined();
      expect(lead.status).toBe("NEW");
      expect(lead.source).toBe("META_LEAD_ADS");
      createdLeadId = lead.id;

      // 1. Check timeline activity
      const activities = await listLeadActivities(ownerContext, createdLeadId);
      expect(activities.length).toBeGreaterThanOrEqual(1);
      expect(activities[0].summary).toContain("Lead created via META_LEAD_ADS");

      // 2. Check immutable audit log
      const auditRes = await pool.query(
        "SELECT * FROM audit_logs WHERE organization_id = $1 AND entity_id = $2 AND action = 'CREATE'",
        [organizationId, createdLeadId],
      );
      expect(auditRes.rows).toHaveLength(1);
      expect(auditRes.rows[0].entity_type).toBe("lead");
    });
  });

  describe("Salesperson Row-Level Isolation & Assignment", () => {
    it("Sales Manager reassigns the lead to Agent A", async () => {
      const updated = await assignLead(
        managerContext,
        createdLeadId,
        agentAContext.userId,
      );
      expect(updated.assigned_user_id).toBe(agentAContext.userId);

      // Verify assignment activity was logged
      const activities = await listLeadActivities(ownerContext, createdLeadId);
      expect(activities[0].summary).toContain(
        "Lead reassigned to Ahmed Agent A",
      );
    });

    it("Agent A sees the assigned lead, but Agent B CANNOT see it in listLeads", async () => {
      // Agent A sees the lead
      const agentALeads = await listLeads(agentAContext);
      expect(agentALeads.map((l) => l.id)).toContain(createdLeadId);

      // Agent B DOES NOT see the lead
      const agentBLeads = await listLeads(agentBContext);
      expect(agentBLeads.map((l) => l.id)).not.toContain(createdLeadId);
    });

    it("Agent B is strictly forbidden from directly fetching or updating Agent A lead", async () => {
      // Direct getLead attempt by Agent B
      await expect(getLead(agentBContext, createdLeadId)).rejects.toThrow(
        ForbiddenError,
      );

      // Status update attempt by Agent B
      await expect(
        updateLeadStatus(agentBContext, createdLeadId, "CONTACTED"),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("Lead Lifecycle & Activity Timeline", () => {
    it("Agent A updates status to CONTACTED and automatically logs a STATUS_CHANGE activity", async () => {
      const updated = await updateLeadStatus(
        agentAContext,
        createdLeadId,
        "CONTACTED",
      );
      expect(updated.status).toBe("CONTACTED");

      const activities = await listLeadActivities(agentAContext, createdLeadId);
      const statusActivity = activities.find(
        (a) => a.activity_type === "STATUS_CHANGE",
      );
      expect(statusActivity).toBeDefined();
      expect(statusActivity?.summary).toBe(
        "Status changed from NEW to CONTACTED",
      );
    });

    it("Agent A logs CALL and WHATSAPP activities on the lead timeline", async () => {
      await logActivity(agentAContext, {
        leadId: createdLeadId,
        activityType: "CALL",
        summary:
          "Phone call: Discussed payment plan options and delivery dates",
        details: { durationSeconds: 320, outcome: "INTERESTED" },
      });

      await logActivity(agentAContext, {
        leadId: createdLeadId,
        activityType: "WHATSAPP",
        summary: "Sent project brochure and masterplan PDF via WhatsApp",
        details: { messageType: "template_brochure" },
      });

      const activities = await listLeadActivities(agentAContext, createdLeadId);
      const activityTypes = activities.map((a) => a.activity_type);
      expect(activityTypes).toContain("CALL");
      expect(activityTypes).toContain("WHATSAPP");
    });
  });

  describe("Follow-up Tasks", () => {
    let taskId: string;

    it("creates a task for Agent A and verifies listTasks", async () => {
      const task = await createTask(agentAContext, {
        leadId: createdLeadId,
        assignedUserId: agentAContext.userId,
        title: "Call to confirm site visit for Saturday",
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        priority: "HIGH",
      });

      expect(task.id).toBeDefined();
      expect(task.is_completed).toBe(false);
      taskId = task.id;

      const agentATasks = await listTasks(agentAContext, {
        isCompleted: false,
      });
      expect(agentATasks.map((t) => t.id)).toContain(taskId);

      // Agent B should NOT see Agent A task
      const agentBTasks = await listTasks(agentBContext);
      expect(agentBTasks.map((t) => t.id)).not.toContain(taskId);
    });

    it("completes the follow-up task", async () => {
      const completed = await completeTask(agentAContext, taskId);
      expect(completed.is_completed).toBe(true);
      expect(completed.completed_by_user_id).toBe(agentAContext.userId);
    });
  });

  describe("Deals & Pipeline Management", () => {
    let dealId: string;

    it("creates a deal attached to the lead with monetary value", async () => {
      const deal = await createDeal(ownerContext, {
        leadId: createdLeadId,
        title: "Twin House Villa 402 - Marassi",
        value: 5500000,
        currency: "EGP",
        stage: "DISCOVERY",
        assignedUserId: agentAContext.userId,
      });

      expect(deal.id).toBeDefined();
      expect(Number(deal.value)).toBe(5500000);
      expect(deal.stage).toBe("DISCOVERY");
      dealId = deal.id;

      // Verify deal creation logged on lead timeline
      const activities = await listLeadActivities(ownerContext, createdLeadId);
      expect(activities[0].summary).toContain(
        "Deal created: Twin House Villa 402 - Marassi",
      );
    });

    it("advances deal stage to PROPOSAL and then to WON", async () => {
      const proposalDeal = await updateDealStage(
        ownerContext,
        dealId,
        "PROPOSAL",
      );
      expect(proposalDeal.stage).toBe("PROPOSAL");

      const wonDeal = await updateDealStage(ownerContext, dealId, "WON");
      expect(wonDeal.stage).toBe("WON");

      const deals = await listDeals(ownerContext, { stage: "WON" });
      expect(deals.map((d) => d.id)).toContain(dealId);
    });
  });

  describe("Multi-Tenant Cross-Organization Isolation on CRM Entities", () => {
    it("foreign organization sees ZERO leads, activities, tasks, or deals", async () => {
      const alienOwner = await registerUser({
        email: `alien.${uniqueSuffix}@otherdev.local`,
        password: "AlienPassword123!",
        fullName: "Alien Developer",
      });

      const alienOrg = await createOrganization({
        userId: alienOwner.id,
        name: "Alien Heights Properties",
        slug: `alien-${uniqueSuffix}`,
      });

      const alienContext: TenantContext = {
        organizationId: alienOrg.id,
        userId: alienOwner.id,
        role: "OWNER",
        correlationId: "alien-req-1",
      };

      // Alien org query must return 0 records from Marassi Heights
      const alienLeads = await listLeads(alienContext);
      expect(alienLeads.map((l) => l.id)).not.toContain(createdLeadId);

      const alienTasks = await listTasks(alienContext);
      expect(alienTasks).toHaveLength(0);

      const alienDeals = await listDeals(alienContext);
      expect(alienDeals).toHaveLength(0);
    });
  });
});
