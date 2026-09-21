import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  createLead,
  createOrganization,
  createRule,
  registerUser,
  triggerRules,
} from "../packages/core/src/index.js";

describe("R1 Lead lifecycle through Smart Rules", () => {
  it("records stage history for an automated Lead status change", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.rules.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Rules Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Rules Org ${suffix}`,
      slug: `r1-rules-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-rules-${suffix}`,
    };

    const rule = await createRule(context, {
      name: "R1 lifecycle transition",
      trigger_type: "lead.status_changed",
      conditions: [],
      actions: [
        {
          action_type: "lead.change_status",
          params: { status: "QUALIFIED" },
          delay_seconds: 0,
        },
      ],
    });

    const lead = await createLead(context, {
      fullName: "R1 Lifecycle Lead",
      phone: `555${suffix}`,
    });

    const executions = await triggerRules(
      context,
      "lead.status_changed",
      "lead",
      lead,
    );
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe("SUCCESS");

    const state = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const leadRes = await tx.query(
          "SELECT status, pipeline_stage_entered_at FROM leads WHERE id = $1",
          [lead.id],
        );
        const historyRes = await tx.query(
          `SELECT to_status, metadata
           FROM lead_stage_history
           WHERE lead_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [lead.id],
        );
        return { lead: leadRes.rows[0], history: historyRes.rows[0] };
      },
    );

    expect(state.lead.status).toBe("QUALIFIED");
    expect(state.lead.pipeline_stage_entered_at).toBeTruthy();
    expect(state.history.to_status).toBe("QUALIFIED");
    expect(state.history.metadata).toMatchObject({
      source: "automation_rule",
      ruleId: rule.id,
      actionType: "lead.change_status",
    });
  });

  it("rejects an invalid automated Lead status without mutating the Lead", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.rules.invalid.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Invalid Rule Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Invalid Rule Org ${suffix}`,
      slug: `r1-invalid-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-invalid-${suffix}`,
    };

    await createRule(context, {
      name: "Invalid lifecycle status",
      trigger_type: "lead.status_changed",
      conditions: [],
      actions: [
        {
          action_type: "lead.change_status",
          params: { status: "NOT_A_REAL_STATUS" },
          delay_seconds: 0,
        },
      ],
    });

    const lead = await createLead(context, {
      fullName: "Invalid Automation Lead",
      phone: `556${suffix}`,
    });

    const executions = await triggerRules(
      context,
      "lead.status_changed",
      "lead",
      lead,
    );

    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe("FAILED");
    expect(executions[0]?.actionsExecuted[0]?.status).toBe("FAILED");
    expect(executions[0]?.actionsExecuted[0]?.error).toContain(
      "Invalid Lead status",
    );

    const state = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const leadRes = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [lead.id],
        );
        const historyRes = await tx.query(
          "SELECT COUNT(*)::int AS count FROM lead_stage_history WHERE lead_id = $1",
          [lead.id],
        );
        return {
          status: leadRes.rows[0]?.status,
          historyCount: historyRes.rows[0]?.count,
        };
      },
    );

    expect(state.status).toBe("NEW");
    expect(state.historyCount).toBe(1);
  });

  it("does not create fake history or activity for an automated no-op transition", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.rules.noop.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Noop Rule Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Noop Rule Org ${suffix}`,
      slug: `r1-noop-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-noop-${suffix}`,
    };

    await createRule(context, {
      name: "No-op lifecycle status",
      trigger_type: "lead.status_changed",
      conditions: [],
      actions: [
        {
          action_type: "lead.change_status",
          params: { status: "NEW" },
          delay_seconds: 0,
        },
      ],
    });

    const lead = await createLead(context, {
      fullName: "Noop Automation Lead",
      phone: `557${suffix}`,
    });

    const executions = await triggerRules(
      context,
      "lead.status_changed",
      "lead",
      lead,
    );

    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe("SUCCESS");
    expect(executions[0]?.actionsExecuted[0]?.result).toMatchObject({
      newStatus: "NEW",
      changed: false,
    });

    const state = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const historyRes = await tx.query(
          "SELECT COUNT(*)::int AS count FROM lead_stage_history WHERE lead_id = $1",
          [lead.id],
        );
        const activityRes = await tx.query(
          `SELECT COUNT(*)::int AS count
           FROM activities
           WHERE lead_id = $1 AND activity_type = 'STATUS_CHANGE'`,
          [lead.id],
        );
        return {
          historyCount: historyRes.rows[0]?.count,
          statusActivityCount: activityRes.rows[0]?.count,
        };
      },
    );

    expect(state.historyCount).toBe(1);
    expect(state.statusActivityCount).toBe(0);
  });
});
