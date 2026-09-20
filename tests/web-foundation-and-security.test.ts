import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
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
  authenticateUser,
  switchOrganization,
  resolveTenantContextFromToken,
  issueTenantToken,
  AuthorizationError,
  AuthenticationError,
  ForbiddenError,
} from "../packages/core/src/index.js";
import { validateWebEnvironment } from "../apps/web/lib/env.js";

describe("Phase 21: Web Application Foundation & Tenant Security Suite", () => {
  const unique = crypto.randomBytes(4).toString("hex");

  let tenantAOrgId: string;
  let tenantBOrgId: string;

  let ownerAUser: any;
  let agentAUser: any;
  let ownerBUser: any;

  let ownerAContext: TenantContext;
  let agentAContext: TenantContext;
  let ownerBContext: TenantContext;

  beforeAll(async () => {
    // 1. Provision Tenant A (Real Estate Co A)
    ownerAUser = await registerUser({
      email: `owner.a.${unique}@company-a.local`,
      password: "SecurePassword2026!",
      fullName: "Nour Owner A",
    });

    const orgA = await createOrganization({
      userId: ownerAUser.id,
      name: `Emaar Misr ${unique}`,
      slug: `emaar-${unique}`,
    });
    tenantAOrgId = orgA.id;

    ownerAContext = {
      organizationId: tenantAOrgId,
      userId: ownerAUser.id,
      role: "OWNER",
      correlationId: `req-a-${unique}`,
    };

    // Invite Sales Agent in Tenant A
    const agentInvite = await inviteMember(ownerAContext, {
      email: `agent.a.${unique}@company-a.local`,
      fullName: "Karim Agent A",
      role: "SALESPERSON",
    });
    agentAUser = { id: agentInvite.userId, email: agentInvite.email };

    agentAContext = {
      organizationId: tenantAOrgId,
      userId: agentAUser.id,
      role: "SALESPERSON",
      correlationId: `req-agent-a-${unique}`,
    };

    // 2. Provision Tenant B (Independent Competitor Co B)
    ownerBUser = await registerUser({
      email: `owner.b.${unique}@company-b.local`,
      password: "SecurePassword2026!",
      fullName: "Tarek Owner B",
    });

    const orgB = await createOrganization({
      userId: ownerBUser.id,
      name: `Sodic Real Estate ${unique}`,
      slug: `sodic-${unique}`,
    });
    tenantBOrgId = orgB.id;

    ownerBContext = {
      organizationId: tenantBOrgId,
      userId: ownerBUser.id,
      role: "OWNER",
      correlationId: `req-b-${unique}`,
    };
  });

  describe("1. Complete Product Flow (Happy Path Verification)", () => {
    let testLeadId: string;

    it("authenticates credentials and issues a valid tenant token", async () => {
      const auth = await authenticateUser(
        `owner.a.${unique}@company-a.local`,
        "SecurePassword2026!",
      );

      expect(auth.user.email).toBe(`owner.a.${unique}@company-a.local`);
      expect(auth.organizations.length).toBeGreaterThanOrEqual(1);
      expect(auth.primaryToken).toBeDefined();

      const context = await resolveTenantContextFromToken(auth.primaryToken);
      expect(context.organizationId).toBe(tenantAOrgId);
      expect(context.userId).toBe(ownerAUser.id);
      expect(context.role).toBe("OWNER");
    });

    it("creates a lead in Tenant A and records the initial timeline event", async () => {
      const lead = await createLead(ownerAContext, {
        fullName: "Hany Prospect",
        phone: "+201099887766",
        email: "hany.prospect@gmail.com",
        source: "META_ADS",
        status: "NEW",
      });

      expect(lead.id).toBeDefined();
      expect(lead.full_name).toBe("Hany Prospect");
      expect(lead.status).toBe("NEW");
      testLeadId = lead.id;

      // Verify initial activity exists
      const activities = await listLeadActivities(ownerAContext, testLeadId);
      expect(activities.length).toBeGreaterThanOrEqual(1);
      expect(activities[0].activity_type).toBe("NOTE");
      expect(activities[0].summary).toContain("Lead created via META_ADS");
    });

    it("updates lead status deliberately and automatically records a STATUS_CHANGE activity", async () => {
      const updated = await updateLeadStatus(
        ownerAContext,
        testLeadId,
        "QUALIFIED",
      );
      expect(updated.status).toBe("QUALIFIED");

      const activities = await listLeadActivities(ownerAContext, testLeadId);
      const statusActivity = activities.find(
        (a) => a.activity_type === "STATUS_CHANGE",
      );
      expect(statusActivity).toBeDefined();
      expect(statusActivity?.summary).toContain(
        "Status changed from NEW to QUALIFIED",
      );
    });

    it("reassigns lead to salesperson and records assignment in timeline", async () => {
      const assigned = await assignLead(
        ownerAContext,
        testLeadId,
        agentAUser.id,
      );
      expect(assigned.assigned_user_id).toBe(agentAUser.id);

      const activities = await listLeadActivities(ownerAContext, testLeadId);
      const assignActivity = activities.find((a) =>
        a.summary.includes("Lead reassigned to"),
      );
      expect(assignActivity).toBeDefined();
    });

    it("appends manual operational notes to the customer timeline", async () => {
      const note = await logActivity(ownerAContext, {
        leadId: testLeadId,
        activityType: "NOTE",
        summary:
          "Client requested modern 3BR duplex in New Cairo with 7yr payment plan.",
      });

      expect(note.id).toBeDefined();

      const activities = await listLeadActivities(ownerAContext, testLeadId);
      expect(activities[0].summary).toBe(
        "Client requested modern 3BR duplex in New Cairo with 7yr payment plan.",
      );
    });

    it("schedules and completes follow-up tasks linked to the lead", async () => {
      const task = await createTask(ownerAContext, {
        leadId: testLeadId,
        assignedUserId: agentAUser.id,
        title: "Send payment schedule sheet",
        dueDate: "2026-10-01",
        priority: "HIGH",
      });

      expect(task.id).toBeDefined();
      expect(task.is_completed).toBe(false);

      const tasks = await listTasks(ownerAContext, { leadId: testLeadId });
      expect(tasks.length).toBe(1);

      const completed = await completeTask(ownerAContext, task.id);
      expect(completed.is_completed).toBe(true);
      expect(completed.completed_at).toBeDefined();
    });
  });

  describe("2. Negative E2E & Cross-Tenant Isolation Boundaries", () => {
    let tenantALeadId: string;

    beforeAll(async () => {
      const lead = await createLead(ownerAContext, {
        fullName: "Confidential VIP Investor",
        phone: "+201111222333",
        source: "REFERRAL",
      });
      tenantALeadId = lead.id;
    });

    it("strictly prevents Tenant B user from reading Tenant A lead", async () => {
      await expect(getLead(ownerBContext, tenantALeadId)).rejects.toThrow(
        "Lead not found",
      );
    });

    it("strictly prevents Tenant B user from listing Tenant A leads", async () => {
      const bLeads = await listLeads(ownerBContext, {});
      const leaked = bLeads.find((l) => l.id === tenantALeadId);
      expect(leaked).toBeUndefined();
    });

    it("strictly prevents Tenant B user from updating status of Tenant A lead", async () => {
      await expect(
        updateLeadStatus(ownerBContext, tenantALeadId, "WON"),
      ).rejects.toThrow("Lead not found");
    });

    it("strictly prevents Tenant B user from reading Tenant A activities", async () => {
      const activities = await listLeadActivities(ownerBContext, tenantALeadId);
      expect(activities.length).toBe(0);
    });
  });

  describe("3. Tenant Spoofing & Session Tampering Defense", () => {
    it("rejects token when user attempts to access an organization they do not belong to", async () => {
      // Attacker creates a signed token pairing User B with Tenant A
      const forgedToken = await issueTenantToken({
        userId: ownerBUser.id,
        organizationId: tenantAOrgId,
        role: "ADMIN",
        email: ownerBUser.email,
      });

      // resolveTenantContextFromToken queries PostgreSQL membership and must reject!
      await expect(resolveTenantContextFromToken(forgedToken)).rejects.toThrow(
        AuthorizationError,
      );
    });

    it("rejects organization switch request when user is not an active member", async () => {
      await expect(
        switchOrganization({
          userId: ownerBUser.id,
          targetOrganizationId: tenantAOrgId,
          email: ownerBUser.email,
        }),
      ).rejects.toThrow("User does not have access to this organization");
    });

    it("rejects authentication with deactivated membership", async () => {
      // Deactivate agentA in Tenant A
      const client = await pool.connect();
      try {
        await client.query(
          "UPDATE organization_memberships SET is_active = false WHERE user_id = $1 AND organization_id = $2",
          [agentAUser.id, tenantAOrgId],
        );
      } finally {
        client.release();
      }

      const agentToken = await issueTenantToken({
        userId: agentAUser.id,
        organizationId: tenantAOrgId,
        role: "SALESPERSON",
        email: agentAUser.email,
      });

      await expect(resolveTenantContextFromToken(agentToken)).rejects.toThrow(
        AuthorizationError,
      );

      // Reactivate agentA for clean state
      const client2 = await pool.connect();
      try {
        await client2.query(
          "UPDATE organization_memberships SET is_active = true WHERE user_id = $1 AND organization_id = $2",
          [agentAUser.id, tenantAOrgId],
        );
      } finally {
        client2.release();
      }
    });
  });

  describe("4. Role Constraints & Least Privilege Permissions", () => {
    it("prevents SALESPERSON from reassigning leads", async () => {
      const lead = await createLead(ownerAContext, {
        fullName: "Agent Unassigned Lead",
        phone: "+201222333444",
        assignedUserId: agentAUser.id,
      });

      await expect(
        assignLead(agentAContext, lead.id, ownerAUser.id),
      ).rejects.toThrow(ForbiddenError);
    });

    it("prevents SALESPERSON from seeing leads assigned to other agents", async () => {
      const unassignedLead = await createLead(ownerAContext, {
        fullName: "Another Agent's Lead",
        phone: "+201555666777",
        assignedUserId: ownerAUser.id, // Not assigned to agentA
      });

      await expect(getLead(agentAContext, unassignedLead.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("5. Production Fail-Closed Environment Validation", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDbUrl = process.env.DATABASE_URL;

    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
      process.env.DATABASE_URL = originalDbUrl;
    });

    it("fails closed immediately in production if DATABASE_URL is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.DATABASE_URL;

      expect(() => validateWebEnvironment()).toThrow(
        /DATABASE_URL is missing in production/i,
      );
    });

    it("fails closed in production if DATABASE_URL uses localhost or default postgres credentials", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL =
        "postgres://postgres:postgrespassword@localhost:5432/business_os";

      expect(() => validateWebEnvironment()).toThrow(
        /DATABASE_URL cannot use default credentials or localhost/i,
      );
    });
  });
});
