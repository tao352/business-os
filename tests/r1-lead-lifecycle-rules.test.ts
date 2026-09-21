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
});
