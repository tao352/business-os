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
  listLeads,
  logActivity,
  listLeadActivities,
  createTask,
  listTasks,
  getDashboardOverview,
  listLeadsPage,
  getLeadWorkspace,
  listProjectsOverview,
  listUnitsInventory,
  getIntegrationStatus,
  listAutomationRules,
  getOrganizationSettings,
} from "../packages/core/src/index.js";

describe("Phase 21 Stabilization: Core Read Models & PII Privacy Protection Suite", () => {
  const unique = crypto.randomBytes(4).toString("hex");

  let orgId: string;
  let ownerUser: any;
  let sales1User: any;
  let sales2User: any;
  let marketingUser: any;

  let ownerContext: TenantContext;
  let sales1Context: TenantContext;
  let sales2Context: TenantContext;
  let marketingContext: TenantContext;

  let lead1: any;
  let lead2: any;

  beforeAll(async () => {
    // 1. Provision Tenant Organization & Owner
    ownerUser = await registerUser({
      email: `owner.${unique}@readmodel.test`,
      password: "Password123!Secure",
      fullName: "Owner ReadModel",
    });

    const org = await createOrganization({
      userId: ownerUser.id,
      name: `ReadModel Dev Corp ${unique}`,
      slug: `readmodel-${unique}`,
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
      email: `sales1.${unique}@readmodel.test`,
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
      email: `sales2.${unique}@readmodel.test`,
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

    // 4. Provision Marketing User (Restricted contact PII role)
    const mInvite = await inviteMember(ownerContext, {
      email: `marketing.${unique}@readmodel.test`,
      fullName: "Marketing User",
      role: "MARKETING_USER",
    });
    marketingUser = { id: mInvite.userId, email: mInvite.email };
    marketingContext = {
      organizationId: orgId,
      userId: marketingUser.id,
      role: "MARKETING_USER",
      correlationId: `req-m-${unique}`,
    };

    // 5. Create Lead 1 assigned to Salesperson 1
    lead1 = await createLead(ownerContext, {
      fullName: "Alice Confidential",
      phone: "+201011112222",
      email: "alice@confidential.com",
      assignedUserId: sales1User.id,
      status: "NEW",
      source: "CAMPAIGN",
    });

    // 6. Create Lead 2 assigned to Salesperson 2
    lead2 = await createLead(ownerContext, {
      fullName: "Bob Restricted",
      phone: "+201033334444",
      email: "bob@restricted.com",
      assignedUserId: sales2User.id,
      status: "QUALIFIED",
      source: "WEBSITE",
    });

    // 7. Add Activities & Tasks to Lead 1 (Salesperson 1)
    await logActivity(sales1Context, {
      leadId: lead1.id,
      activityType: "NOTE",
      summary: "Called Alice regarding Villa 305 inquiry",
    });

    await createTask(sales1Context, {
      leadId: lead1.id,
      assignedUserId: sales1User.id,
      title: "Follow up with Alice on contract terms",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      priority: "HIGH",
    });

    // 8. Add Activities & Tasks to Lead 2 (Salesperson 2)
    await logActivity(sales2Context, {
      leadId: lead2.id,
      activityType: "CALL",
      summary: "Spoke with Bob about commercial units",
    });

    await createTask(sales2Context, {
      leadId: lead2.id,
      assignedUserId: sales2User.id,
      title: "Schedule site visit for Bob",
      dueDate: new Date(Date.now() + 172800000).toISOString(),
      priority: "MEDIUM",
    });
  });

  describe("1. getDashboardOverview (Role-Aware Activity & Ownership Isolation)", () => {
    it("strictly isolates operational metrics, recent leads, and activities for SALESPERSON", async () => {
      const s1Dashboard = await getDashboardOverview(sales1Context);

      // Salesperson 1 must only count their own assigned leads
      expect(s1Dashboard.totalLeads).toBe(1);
      expect(s1Dashboard.newLeads).toBe(1);

      // Salesperson 1 must only see Lead 1 in recent leads
      expect(s1Dashboard.recentLeads.length).toBe(1);
      expect(s1Dashboard.recentLeads[0].id).toBe(lead1.id);
      expect(s1Dashboard.recentLeads[0].full_name).toBe("Alice Confidential");

      // Salesperson 1 must only see Lead 1 activities - ZERO Lead 2 activity leaked
      expect(s1Dashboard.recentActivities.length).toBeGreaterThanOrEqual(1);
      for (const act of s1Dashboard.recentActivities) {
        expect(act.lead_id).toBe(lead1.id);
        expect(act.summary).not.toContain("Bob");
      }

      // Salesperson 1 must only see their own tasks
      expect(s1Dashboard.openTasksList.length).toBe(1);
      expect(s1Dashboard.openTasksList[0].assigned_user_id).toBe(sales1User.id);
    });

    it("aggregates tenant-wide operational data for OWNER", async () => {
      const ownerDashboard = await getDashboardOverview(ownerContext);

      // Owner sees total across all agents
      expect(ownerDashboard.totalLeads).toBeGreaterThanOrEqual(2);
      expect(ownerDashboard.recentActivities.length).toBeGreaterThanOrEqual(2);

      const leadIdsInActivity = ownerDashboard.recentActivities.map(
        (a) => a.lead_id,
      );
      expect(leadIdsInActivity).toContain(lead1.id);
      expect(leadIdsInActivity).toContain(lead2.id);
    });

    it("allows MARKETING_USER to access aggregated dashboard metrics without leaking PII or tasks", async () => {
      const dashboard = await getDashboardOverview(marketingContext);
      expect(dashboard.totalLeads).toBeGreaterThanOrEqual(2);
      expect(dashboard.newLeads).toBeGreaterThanOrEqual(1);
      expect(dashboard.openTasks).toBe(0);
      expect(dashboard.recentActivities).toEqual([]);
      expect(dashboard.recentLeads).toEqual([]);
      expect(dashboard.openTasksList).toEqual([]);
    });
  });

  describe("2. listLeadsPage (Server-Side Field-Level PII Redaction & Aggregate Enforcing)", () => {
    it("returns aggregate count only and withholds individual lead rows for MARKETING_USER", async () => {
      const result = await listLeadsPage(marketingContext);

      expect(result.totalCount).toBeGreaterThanOrEqual(2);
      expect(result.leads).toEqual([]);
      expect(result.individualRecordsRestricted).toBe(true);
    });

    it("provides full contact details to authorized OWNER", async () => {
      const result = await listLeadsPage(ownerContext);

      expect(result.totalCount).toBeGreaterThanOrEqual(2);
      const foundAlice = result.leads.find((l) => l.id === lead1.id);
      expect(foundAlice).toBeDefined();
      expect(foundAlice?.full_name).toBe("Alice Confidential");
      expect(foundAlice?.phone).toBe("+201011112222");
      expect(foundAlice?.email).toBe("alice@confidential.com");
      expect(foundAlice?.contact_info_redacted).toBeFalsy();
    });

    it("filters by status and search criteria", async () => {
      const searchRes = await listLeadsPage(ownerContext, { search: "Alice" });
      expect(searchRes.leads.length).toBe(1);
      expect(searchRes.leads[0].id).toBe(lead1.id);

      const statusRes = await listLeadsPage(ownerContext, {
        status: "QUALIFIED",
      });
      expect(statusRes.leads.length).toBe(1);
      expect(statusRes.leads[0].id).toBe(lead2.id);
    });
  });

  describe("3. getLeadWorkspace (Detail Workspace Read Model)", () => {
    it("strictly blocks MARKETING_USER from accessing individual lead workspace dossiers", async () => {
      await expect(
        getLeadWorkspace(marketingContext, lead1.id),
      ).rejects.toThrow(
        /Role 'MARKETING_USER' is restricted to aggregated analytics/,
      );
    });

    it("returns complete lead workspace including tasks, timeline, and assignee for OWNER", async () => {
      const workspace = await getLeadWorkspace(ownerContext, lead1.id);

      expect(workspace.lead.id).toBe(lead1.id);
      expect(workspace.lead.full_name).toBe("Alice Confidential");
      expect(workspace.lead.phone).toBe("+201011112222");
      expect(workspace.assignedName).toContain("Salesperson One");
      expect(workspace.activities.length).toBeGreaterThanOrEqual(1);
      expect(workspace.tasks.length).toBe(1);
      expect(workspace.tasks[0].title).toBe(
        "Follow up with Alice on contract terms",
      );
      expect(workspace.members.length).toBeGreaterThanOrEqual(4);
    });

    it("rejects SALESPERSON attempting to read a lead assigned to another agent", async () => {
      // Salesperson 1 attempts to open Lead 2 (assigned to Salesperson 2)
      await expect(getLeadWorkspace(sales1Context, lead2.id)).rejects.toThrow();
    });
  });

  describe("4. Runtime Schema Verification (Integrations, Automations, Projects, Units, Settings)", () => {
    it("listProjectsOverview executes cleanly without fabricated status badge", async () => {
      // Seed a project and unit
      await withTenantContext(orgId, async (tx) => {
        const pRes = await tx.query(
          `INSERT INTO projects (organization_id, name, location, total_units)
           VALUES ($1, 'Palm Hills New Cairo', 'New Cairo', 50)
           RETURNING id`,
          [orgId],
        );
        await tx.query(
          `INSERT INTO units (organization_id, project_id, unit_number, unit_type, gross_area, price, status)
           VALUES ($1, $2, 'PH-101', 'Villa', 320, 15000000, 'AVAILABLE')`,
          [orgId, pRes.rows[0].id],
        );
      });

      const projects = await listProjectsOverview(ownerContext);
      expect(projects.length).toBeGreaterThanOrEqual(1);
      const palmHills = projects.find((p) => p.name === "Palm Hills New Cairo");
      expect(palmHills).toBeDefined();
      expect(palmHills?.available_units).toBe(1);
      expect(palmHills?.units_count).toBe(1);
      // Status property must not exist on project
      expect((palmHills as any).status).toBeUndefined();
    });

    it("listUnitsInventory implements truthful totalCount and pagination", async () => {
      const res = await listUnitsInventory(ownerContext, {
        page: 1,
        pageSize: 10,
      });
      expect(res.totalCount).toBeGreaterThanOrEqual(1);
      expect(res.units.length).toBeGreaterThanOrEqual(1);
      expect(res.page).toBe(1);
      expect(res.pageSize).toBe(10);
      expect(res.units[0].unit_number).toBe("PH-101");
      expect(res.units[0].project_name).toBe("Palm Hills New Cairo");
    });

    it("getIntegrationStatus queries meta_integrations and whatsapp_integrations without relation errors and without secret leaks", async () => {
      // Seed an active integration into real tables
      const uniquePageId = `page_${unique}_123456`;
      const uniquePhoneId = `wa_${unique}_987654`;

      await withTenantContext(orgId, async (tx) => {
        await tx.query(
          `INSERT INTO meta_integrations (organization_id, page_id, page_name, page_access_token, app_secret, verify_token, is_active)
           VALUES ($1, $2, 'Official Palm Hills FB Page', 'SECRET_ACCESS_TOKEN_DO_NOT_LEAK', 'SECRET_APP_SECRET', 'VERIFY_TOKEN_XYZ', true)
           ON CONFLICT (organization_id, page_id) DO NOTHING`,
          [orgId, uniquePageId],
        );
        await tx.query(
          `INSERT INTO whatsapp_integrations (organization_id, phone_number_id, waba_id, phone_number, access_token, app_secret, verify_token, is_active)
           VALUES ($1, $2, 'waba_111', '+201099990000', 'SECRET_WA_TOKEN', 'SECRET_WA_SECRET', 'VERIFY_WA', true)
           ON CONFLICT (organization_id, phone_number_id) DO NOTHING`,
          [orgId, uniquePhoneId],
        );
      });

      const integrations = await getIntegrationStatus(ownerContext);

      expect(integrations.meta.connected).toBe(true);
      expect(integrations.meta.pageName).toBe("Official Palm Hills FB Page");
      expect(integrations.meta.pageIdMasked).toBe("••••3456");
      // Zero secrets leaked
      expect((integrations.meta as any).page_access_token).toBeUndefined();
      expect((integrations.meta as any).app_secret).toBeUndefined();

      expect(integrations.whatsapp.connected).toBe(true);
      expect(integrations.whatsapp.phoneDisplay).toBe("+201099990000");
      expect(integrations.whatsapp.phoneNumberIdMasked).toBe("••••7654");
      expect((integrations.whatsapp as any).access_token).toBeUndefined();
      expect((integrations.whatsapp as any).app_secret).toBeUndefined();
    });

    it("listAutomationRules queries automation_rules with trigger_type without relation errors", async () => {
      // Seed a rule into real automation_rules table
      await withTenantContext(orgId, async (tx) => {
        await tx.query(
          `INSERT INTO automation_rules (organization_id, name, trigger_type, is_active)
           VALUES ($1, 'Instant WhatsApp Welcome on Lead Create', 'lead.created', true)`,
          [orgId],
        );
      });

      const rules = await listAutomationRules(ownerContext);
      expect(rules.length).toBeGreaterThanOrEqual(1);
      const rule = rules.find(
        (r) => r.name === "Instant WhatsApp Welcome on Lead Create",
      );
      expect(rule).toBeDefined();
      expect(rule?.trigger_type).toBe("lead.created");
      expect(rule?.is_active).toBe(true);
    });

    it("getOrganizationSettings returns workspace profile and member list", async () => {
      const settings = await getOrganizationSettings(ownerContext);
      expect(settings.organization?.id).toBe(orgId);
      expect(settings.organization?.name).toBe(`ReadModel Dev Corp ${unique}`);
      expect(settings.members.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("5. Core Service RBAC & Individual Lead Access Policy Enforcement", () => {
    it("strictly denies MARKETING_USER on getLead(), listLeads(), listLeadActivities(), listTasks()", async () => {
      await expect(getLead(marketingContext, lead1.id)).rejects.toThrow();
      await expect(listLeads(marketingContext)).rejects.toThrow();
      await expect(
        listLeadActivities(marketingContext, lead1.id),
      ).rejects.toThrow();
      const tasks = await listTasks(marketingContext);
      expect(tasks).toEqual([]);
    });

    it("denies SALESPERSON from reading lead assigned to another agent across all CRM services", async () => {
      await expect(getLead(sales1Context, lead2.id)).rejects.toThrow();
      await expect(
        listLeadActivities(sales1Context, lead2.id),
      ).rejects.toThrow();
      await expect(
        listTasks(sales1Context, { leadId: lead2.id }),
      ).rejects.toThrow();
    });

    it("denies non-admin roles from accessing privileged system configurations", async () => {
      // SALESPERSON cannot access automation rules, integration status, or organization settings
      await expect(listAutomationRules(sales1Context)).rejects.toThrow();
      await expect(getIntegrationStatus(sales1Context)).rejects.toThrow();
      await expect(getOrganizationSettings(sales1Context)).rejects.toThrow();

      // MARKETING_USER cannot access automation rules, integration status, or settings
      await expect(listAutomationRules(marketingContext)).rejects.toThrow();
      await expect(getIntegrationStatus(marketingContext)).rejects.toThrow();
      await expect(getOrganizationSettings(marketingContext)).rejects.toThrow();
    });
  });
});
