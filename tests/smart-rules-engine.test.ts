import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool, withTenantContext } from "../packages/database/src/index.js";
import type { TenantContext, SmartRule } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  inviteMember,
  createRule,
  getRule,
  updateRule,
  listRules,
  deleteRule,
  triggerRules,
  dryRunRule,
  createLead,
} from "../packages/core/src/index.js";

describe("Phase 10: Smart Rules Automation Engine (TCA Live Tests)", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  let agent1Id: string;
  let agent2Id: string;
  let activeRule: SmartRule;

  beforeAll(async () => {
    // 1. Apply Migration 0007
    const migration7 = fs.readFileSync(
      path.resolve(
        __dirname,
        "../packages/database/migrations/0007_smart_rules.sql",
      ),
      "utf-8",
    );
    const client = await pool.connect();
    try {
      await client.query(migration7);
    } finally {
      client.release();
    }

    // 2. Setup Org A (Palm Hills)
    const ownerA = await registerUser({
      email: `owner.palm.${uniqueSuffix}@palmhills.local`,
      password: "StrongPassword2026!",
      fullName: "Yasseen Mansour",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Palm Hills Developments ${uniqueSuffix}`,
      slug: `palmhills-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `test-tca-org-a-${uniqueSuffix}`,
    };

    // Invite Agent 1 and Agent 2 to Org A
    const agent1 = await inviteMember(orgAContext, {
      email: `agent1.${uniqueSuffix}@palmhills.local`,
      fullName: "Mohamed Sales Rep 1",
      role: "SALESPERSON",
    });
    agent1Id = agent1.userId;

    const agent2 = await inviteMember(orgAContext, {
      email: `agent2.${uniqueSuffix}@palmhills.local`,
      fullName: "Sarah Sales Rep 2",
      role: "SALESPERSON",
    });
    agent2Id = agent2.userId;

    // 3. Setup Org B (Mountain View)
    const ownerB = await registerUser({
      email: `owner.mv.${uniqueSuffix}@mountainview.local`,
      password: "StrongPassword2026!",
      fullName: "Amr Soliman",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Mountain View ${uniqueSuffix}`,
      slug: `mv-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `test-tca-org-b-${uniqueSuffix}`,
    };
  });

  describe("1. Rule Definition CRUD & Management", () => {
    it("creates a parameterized TCA Smart Rule", async () => {
      activeRule = await createRule(orgAContext, {
        name: "VIP High-Budget Round-Robin Dispatcher",
        description:
          "Distributes leads with budget > 5M among sales reps and creates immediate call task",
        trigger_type: "lead.created",
        conditions: [
          {
            field: "custom_data.budget",
            operator: "greater_than",
            value: 5000000,
          },
        ],
        actions: [
          {
            action_type: "lead.assign_round_robin",
            params: {
              user_ids: [agent1Id, agent2Id],
            },
            delay_seconds: 0,
          },
          {
            action_type: "task.create",
            params: {
              title: "Urgent VIP Client Contact",
              description:
                "Client budget exceeds 5,000,000 EGP. Contact within 1 hour.",
              priority: "URGENT",
              due_in_hours: 1,
            },
            delay_seconds: 0,
          },
        ],
      });

      expect(activeRule.id).toBeDefined();
      expect(activeRule.name).toBe("VIP High-Budget Round-Robin Dispatcher");
      expect(activeRule.is_active).toBe(true);
      expect(activeRule.conditions).toHaveLength(1);
      expect(activeRule.actions).toHaveLength(2);
    });

    it("retrieves rule by ID and lists rules by trigger type", async () => {
      const fetched = await getRule(orgAContext, activeRule.id);
      expect(fetched.id).toBe(activeRule.id);

      const rules = await listRules(orgAContext, "lead.created");
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules.some((r) => r.id === activeRule.id)).toBe(true);
    });

    it("updates rule configuration and increments version", async () => {
      const updated = await updateRule(orgAContext, activeRule.id, {
        description: "Updated VIP Dispatcher rules with priority SLA",
      });

      expect(updated.version).toBe(2);
      expect(updated.description).toBe(
        "Updated VIP Dispatcher rules with priority SLA",
      );
    });
  });

  describe("2. Historical Dry-Run Simulation (Zero Mutation Safety)", () => {
    let leadLowId: string;
    let leadHigh1Id: string;
    let leadHigh2Id: string;

    beforeAll(async () => {
      // Create test leads with varied budgets
      const l1 = await createLead(orgAContext, {
        fullName: "خالد سليم (ميزانية منخفضة)",
        phone: `+2011000011${uniqueSuffix.slice(0, 2)}`,
        customData: { budget: 3000000 },
      });
      leadLowId = l1.id;

      const l2 = await createLead(orgAContext, {
        fullName: "طارق نور (ميزانية مرتفعة 1)",
        phone: `+2011000022${uniqueSuffix.slice(0, 2)}`,
        customData: { budget: 7500000 },
      });
      leadHigh1Id = l2.id;

      const l3 = await createLead(orgAContext, {
        fullName: "هشام طلعت (ميزانية مرتفعة 2)",
        phone: `+2011000033${uniqueSuffix.slice(0, 2)}`,
        customData: { budget: 15000000 },
      });
      leadHigh2Id = l3.id;
    });

    it("simulates rule impact on existing records without mutating database", async () => {
      const simulation = await dryRunRule(orgAContext, activeRule, 50);

      expect(simulation.totalSampled).toBeGreaterThanOrEqual(3);
      expect(simulation.matchedCount).toBeGreaterThanOrEqual(2);
      expect(simulation.matchingEntityIds).toContain(leadHigh1Id);
      expect(simulation.matchingEntityIds).toContain(leadHigh2Id);
      expect(simulation.matchingEntityIds).not.toContain(leadLowId);

      expect(simulation.simulatedActions).toHaveLength(2);
      expect(simulation.simulatedActions[0].action_type).toBe(
        "lead.assign_round_robin",
      );
      expect(simulation.simulatedActions[0].targetCount).toBe(
        simulation.matchedCount,
      );

      // Verify that leadHigh1 is STILL unassigned (no mutations occurred during dry run)
      const leadCheck = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT assigned_user_id FROM leads WHERE id = $1",
            [leadHigh1Id],
          );
          return res.rows[0];
        },
      );
      expect(leadCheck.assigned_user_id).toBeNull();
    });
  });

  describe("3. Live Rule Triggering & Round-Robin Rotation", () => {
    it("executes rule for qualifying lead and assigns to Agent 1", async () => {
      const leadPayload = {
        id: `lead_live_1_${uniqueSuffix}`,
        full_name: "عماد الدين أديب",
        phone: `+2011998811${uniqueSuffix.slice(0, 2)}`,
        custom_data: { budget: 9000000 }, // > 5,000,000
      };

      // Create lead directly
      const lead = await createLead(orgAContext, {
        fullName: leadPayload.full_name,
        phone: leadPayload.phone,
        customData: leadPayload.custom_data,
      });

      // Trigger Smart Rules for 'lead.created'
      const executions = await triggerRules(
        orgAContext,
        "lead.created",
        "lead",
        lead,
      );

      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe("SUCCESS");
      expect(executions[0].actionsExecuted).toHaveLength(2);
      expect(executions[0].actionsExecuted[0].action_type).toBe(
        "lead.assign_round_robin",
      );
      expect(executions[0].actionsExecuted[0].status).toBe("SUCCESS");

      // Verify Lead Assigned to Agent 1
      const updatedLead = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM leads WHERE id = $1", [
            lead.id,
          ]);
          return res.rows[0];
        },
      );
      expect(updatedLead.assigned_user_id).toBe(agent1Id);

      // Verify Follow-up Task Created
      const tasks = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM tasks WHERE lead_id = $1", [
            lead.id,
          ]);
          return res.rows;
        },
      );
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Urgent VIP Client Contact");
      expect(tasks[0].priority).toBe("URGENT");
      expect(tasks[0].assigned_user_id).toBe(agent1Id);
    });

    it("rotates to Agent 2 on the next qualifying lead (Round-Robin Invariant)", async () => {
      const leadPayload2 = {
        id: `lead_live_2_${uniqueSuffix}`,
        full_name: "شريف إسماعيل",
        phone: `+2011998822${uniqueSuffix.slice(0, 2)}`,
        custom_data: { budget: 12000000 }, // > 5,000,000
      };

      const lead2 = await createLead(orgAContext, {
        fullName: leadPayload2.full_name,
        phone: leadPayload2.phone,
        customData: leadPayload2.custom_data,
      });

      const executions = await triggerRules(
        orgAContext,
        "lead.created",
        "lead",
        lead2,
      );
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe("SUCCESS");

      // Verify Lead Assigned to Agent 2 (Round-Robin alternating!)
      const updatedLead2 = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM leads WHERE id = $1", [
            lead2.id,
          ]);
          return res.rows[0];
        },
      );
      expect(updatedLead2.assigned_user_id).toBe(agent2Id);
    });

    it("ignores non-qualifying leads with budget below threshold", async () => {
      const leadLow = await createLead(orgAContext, {
        fullName: "علاء عبد العظيم (ميزانية عادية)",
        phone: `+2011998833${uniqueSuffix.slice(0, 2)}`,
        customData: { budget: 2000000 }, // < 5,000,000
      });

      const executions = await triggerRules(
        orgAContext,
        "lead.created",
        "lead",
        leadLow,
      );
      expect(executions).toHaveLength(0); // Condition not met

      const leadCheck = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT assigned_user_id FROM leads WHERE id = $1",
            [leadLow.id],
          );
          return res.rows[0];
        },
      );
      expect(leadCheck.assigned_user_id).toBeNull();
    });
  });

  describe("4. Audit Trail & Execution Counter", () => {
    it("verifies execution counters and audit logs in rule_executions table", async () => {
      const rule = await getRule(orgAContext, activeRule.id);
      expect(rule.execution_count).toBe(2);
      expect(rule.last_triggered_at).toBeDefined();

      const executions = await withTenantContext(
        orgAContext.organizationId,
        async (tx) => {
          const res = await tx.query(
            "SELECT * FROM rule_executions WHERE rule_id = $1 ORDER BY created_at ASC",
            [activeRule.id],
          );
          return res.rows;
        },
      );

      expect(executions).toHaveLength(2);
      expect(executions[0].status).toBe("SUCCESS");
      expect(executions[0].hop_depth).toBe(1);
      expect(executions[0].execution_duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("5. Safety Guard & Recursion Limit", () => {
    it("halts and aborts execution when hop depth exceeds 3 (Recursion Guard)", async () => {
      const mockLead = { id: "dummy_lead_999", budget: 10000000 };
      const res = await triggerRules(
        orgAContext,
        "lead.created",
        "lead",
        mockLead,
        {
          hopDepth: 4, // Exceeds limit
        },
      );

      expect(res).toHaveLength(1);
      expect(res[0].status).toBe("FAILED");
      expect(res[0].errorMessage).toContain("Max recursion depth exceeded");
    });
  });

  describe("6. Multi-Tenant Isolation (Zero Leak Invariant)", () => {
    it("ensures Org B cannot see or execute Org A rules or execution records", async () => {
      // Org B lists rules
      const orgBRules = await listRules(orgBContext);
      expect(orgBRules).toHaveLength(0);

      // Org B queries rule_executions
      const orgBExecs = await withTenantContext(
        orgBContext.organizationId,
        async (tx) => {
          const res = await tx.query("SELECT * FROM rule_executions");
          return res.rows;
        },
      );
      expect(orgBExecs).toHaveLength(0);

      // Org B attempting to get Org A rule throws not found
      await expect(getRule(orgBContext, activeRule.id)).rejects.toThrow(
        /not found/,
      );
    });
  });
});
