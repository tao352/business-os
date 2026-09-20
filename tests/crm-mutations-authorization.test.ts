import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  inviteMember,
  createLead,
  getLead,
  updateLeadStatus,
  logActivity,
  createTask,
  completeTask,
  getUiCapabilities,
} from "../packages/core/src/index.js";

describe("Phase 21 CRM Mutations Authorization & Capabilities Suite", () => {
  const unique = crypto.randomBytes(4).toString("hex");

  let orgId: string;
  let ownerUser: any;
  let sales1User: any;
  let sales2User: any;
  let readOnlyUser: any;
  let marketingUser: any;
  let financeUser: any;

  let ownerContext: TenantContext;
  let sales1Context: TenantContext;
  let sales2Context: TenantContext;
  let readOnlyContext: TenantContext;
  let marketingContext: TenantContext;
  let financeContext: TenantContext;

  let lead1: any;
  let lead2: any;
  let task1: any;
  let task2: any;

  beforeAll(async () => {
    // 1. Provision Tenant Organization & Owner
    ownerUser = await registerUser({
      email: `owner.${unique}@mutations.test`,
      password: "Password123!Secure",
      fullName: "Owner Mutations",
    });

    const org = await createOrganization({
      userId: ownerUser.id,
      name: `Mutations Suite Corp ${unique}`,
      slug: `mutations-${unique}`,
    });
    orgId = org.id;

    ownerContext = {
      organizationId: orgId,
      userId: ownerUser.id,
      role: "OWNER",
      correlationId: `req-owner-${unique}`,
    };

    // 2. Provision Salesperson 1
    const s1Invite = await inviteMember(ownerContext, {
      email: `sales1.${unique}@mutations.test`,
      fullName: "Salesperson One",
      role: "SALESPERSON",
    });
    sales1User = { id: s1Invite.userId, email: s1Invite.email };
    sales1Context = {
      organizationId: orgId,
      userId: sales1User.id,
      role: "SALESPERSON",
      correlationId: `req-s1-${unique}`,
    };

    // 3. Provision Salesperson 2
    const s2Invite = await inviteMember(ownerContext, {
      email: `sales2.${unique}@mutations.test`,
      fullName: "Salesperson Two",
      role: "SALESPERSON",
    });
    sales2User = { id: s2Invite.userId, email: s2Invite.email };
    sales2Context = {
      organizationId: orgId,
      userId: sales2User.id,
      role: "SALESPERSON",
      correlationId: `req-s2-${unique}`,
    };

    // 4. Provision READ_ONLY Member
    const roInvite = await inviteMember(ownerContext, {
      email: `readonly.${unique}@mutations.test`,
      fullName: "Read Only User",
      role: "READ_ONLY",
    });
    readOnlyUser = { id: roInvite.userId, email: roInvite.email };
    readOnlyContext = {
      organizationId: orgId,
      userId: readOnlyUser.id,
      role: "READ_ONLY",
      correlationId: `req-ro-${unique}`,
    };

    // 5. Provision MARKETING_USER
    const mInvite = await inviteMember(ownerContext, {
      email: `marketing.${unique}@mutations.test`,
      fullName: "Marketing Analyst",
      role: "MARKETING_USER",
    });
    marketingUser = { id: mInvite.userId, email: mInvite.email };
    marketingContext = {
      organizationId: orgId,
      userId: marketingUser.id,
      role: "MARKETING_USER",
      correlationId: `req-m-${unique}`,
    };

    // 6. Provision FINANCE Member
    const fInvite = await inviteMember(ownerContext, {
      email: `finance.${unique}@mutations.test`,
      fullName: "Finance Controller",
      role: "FINANCE",
    });
    financeUser = { id: fInvite.userId, email: fInvite.email };
    financeContext = {
      organizationId: orgId,
      userId: financeUser.id,
      role: "FINANCE",
      correlationId: `req-fin-${unique}`,
    };

    // 7. Seed Leads: Lead 1 for Salesperson 1, Lead 2 for Salesperson 2
    lead1 = await createLead(ownerContext, {
      fullName: "Client Alpha",
      phone: "+201011110001",
      email: "alpha@client.com",
      assignedUserId: sales1User.id,
      status: "NEW",
      source: "CAMPAIGN",
    });

    lead2 = await createLead(ownerContext, {
      fullName: "Client Beta",
      phone: "+201011110002",
      email: "beta@client.com",
      assignedUserId: sales2User.id,
      status: "NEW",
      source: "WEBSITE",
    });

    // 8. Seed Tasks: Task 1 for Salesperson 1, Task 2 for Salesperson 2
    task1 = await createTask(sales1Context, {
      leadId: lead1.id,
      assignedUserId: sales1User.id,
      title: "Call Alpha regarding reservation",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });

    task2 = await createTask(sales2Context, {
      leadId: lead2.id,
      assignedUserId: sales2User.id,
      title: "Prepare proposal for Beta",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
  });

  describe("1. READ_ONLY Role Mutation Enforcement", () => {
    it("denies READ_ONLY from creating tasks", async () => {
      await expect(
        createTask(readOnlyContext, {
          leadId: lead1.id,
          assignedUserId: readOnlyUser.id,
          title: "Unauthorized task",
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow();
    });

    it("denies READ_ONLY from completing tasks", async () => {
      await expect(completeTask(readOnlyContext, task1.id)).rejects.toThrow();
    });

    it("denies READ_ONLY from logging activities", async () => {
      await expect(
        logActivity(readOnlyContext, {
          leadId: lead1.id,
          activityType: "NOTE",
          summary: "Unauthorized note attempt",
        }),
      ).rejects.toThrow();
    });

    it("denies READ_ONLY from updating lead status", async () => {
      await expect(
        updateLeadStatus(readOnlyContext, lead1.id, "QUALIFIED"),
      ).rejects.toThrow();
    });
  });

  describe("2. MARKETING_USER Role Mutation Enforcement", () => {
    it("denies MARKETING_USER from creating tasks", async () => {
      await expect(
        createTask(marketingContext, {
          leadId: lead1.id,
          assignedUserId: marketingUser.id,
          title: "Marketing task",
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow();
    });

    it("denies MARKETING_USER from completing tasks", async () => {
      await expect(completeTask(marketingContext, task1.id)).rejects.toThrow();
    });

    it("denies MARKETING_USER from logging activities", async () => {
      await expect(
        logActivity(marketingContext, {
          leadId: lead1.id,
          activityType: "NOTE",
          summary: "Marketing note attempt",
        }),
      ).rejects.toThrow();
    });

    it("denies MARKETING_USER from updating lead status", async () => {
      await expect(
        updateLeadStatus(marketingContext, lead1.id, "CONTACTED"),
      ).rejects.toThrow();
    });
  });

  describe("3. SALESPERSON Row-Level Boundary & Atomic Rollback", () => {
    it("denies SALESPERSON 1 from logging activity on SALESPERSON 2 lead and preserves last_contacted_at", async () => {
      // Record baseline last_contacted_at
      const baselineLead = await getLead(ownerContext, lead2.id);
      const baselineLastContacted = baselineLead.last_contacted_at;

      await expect(
        logActivity(sales1Context, {
          leadId: lead2.id,
          activityType: "NOTE",
          summary: "Intruder note on salesperson 2 lead",
        }),
      ).rejects.toThrow();

      // Verify transaction rolled back: last_contacted_at was NOT modified
      const currentLead = await getLead(ownerContext, lead2.id);
      expect(currentLead.last_contacted_at).toBe(baselineLastContacted);
    });

    it("denies SALESPERSON 1 from creating task on SALESPERSON 2 lead", async () => {
      await expect(
        createTask(sales1Context, {
          leadId: lead2.id,
          assignedUserId: sales1User.id,
          title: "Intruder task attempt",
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow();
    });

    it("denies SALESPERSON 1 from completing SALESPERSON 2 task", async () => {
      await expect(completeTask(sales1Context, task2.id)).rejects.toThrow();
    });

    it("allows SALESPERSON 1 to create task, complete task, and log activity on their assigned lead", async () => {
      const activity = await logActivity(sales1Context, {
        leadId: lead1.id,
        activityType: "NOTE",
        summary: "Legitimate follow-up note by Salesperson 1",
      });
      expect(activity.id).toBeDefined();
      expect(activity.lead_id).toBe(lead1.id);

      const newTask = await createTask(sales1Context, {
        leadId: lead1.id,
        assignedUserId: sales1User.id,
        title: "Legitimate task for Alpha",
        dueDate: new Date().toISOString(),
      });
      expect(newTask.id).toBeDefined();

      const completed = await completeTask(sales1Context, newTask.id);
      expect(completed.is_completed).toBe(true);
      expect(completed.completed_by_user_id).toBe(sales1User.id);
    });
  });

  describe("4. Assignee Membership Validation", () => {
    it("rejects task creation when assigned user is not a member of the organization", async () => {
      const foreignUserId = crypto.randomUUID();
      await expect(
        createTask(ownerContext, {
          leadId: lead1.id,
          assignedUserId: foreignUserId,
          title: "Task with nonexistent user",
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow(/not an active member/i);
    });
  });

  describe("5. Authoritative UI Capabilities Resolution", () => {
    it("resolves capabilities accurately for FINANCE: canReadUnits true, canReadProjects false", () => {
      const caps = getUiCapabilities(financeContext);
      expect(caps.canReadUnits).toBe(true);
      expect(caps.canReadProjects).toBe(false);
      expect(caps.canCreateLead).toBe(false);
      expect(caps.canReadAutomations).toBe(false);
      expect(caps.canReadIntegrations).toBe(false);
      expect(caps.canReadSettings).toBe(false);
    });

    it("resolves capabilities accurately for READ_ONLY: canReadUnits and Projects true, canCreateLead false", () => {
      const caps = getUiCapabilities(readOnlyContext);
      expect(caps.canReadUnits).toBe(true);
      expect(caps.canReadProjects).toBe(true);
      expect(caps.canCreateLead).toBe(false);
      expect(caps.canExportLeads).toBe(false);
      expect(caps.canUpdateAllLeads).toBe(false);
      expect(caps.canReadAutomations).toBe(false);
    });

    it("resolves capabilities accurately for MARKETING_USER: cannot read inventory or privileged config", () => {
      const caps = getUiCapabilities(marketingContext);
      expect(caps.canReadUnits).toBe(false);
      expect(caps.canReadProjects).toBe(false);
      expect(caps.canCreateLead).toBe(false);
      expect(caps.canReadAutomations).toBe(false);
    });

    it("resolves capabilities accurately for OWNER: full capabilities", () => {
      const caps = getUiCapabilities(ownerContext);
      expect(caps.canCreateLead).toBe(true);
      expect(caps.canExportLeads).toBe(true);
      expect(caps.canUpdateAllLeads).toBe(true);
      expect(caps.canReadProjects).toBe(true);
      expect(caps.canReadUnits).toBe(true);
      expect(caps.canReadAutomations).toBe(true);
      expect(caps.canReadIntegrations).toBe(true);
      expect(caps.canReadSettings).toBe(true);
    });
  });
});
