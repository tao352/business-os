import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  CreateRuleInput,
  SmartRule,
  DryRunResult,
} from "@business-os/types";
import { evaluateAllConditions } from "../rules-evaluator.js";

/**
 * Executes a historical dry-run simulation of a Smart Rule against existing CRM records.
 * Provides a predictive impact analysis without performing any database mutations.
 */
export async function dryRunRule(
  context: TenantContext,
  ruleInput: CreateRuleInput | SmartRule,
  sampleLimit = 50,
): Promise<DryRunResult> {
  return await withTenantContext(context.organizationId, async (tx) => {
    let tableName = "leads";
    if (ruleInput.trigger_type.startsWith("task.")) {
      tableName = "tasks";
    } else if (ruleInput.trigger_type.startsWith("visit.")) {
      tableName = "visits";
    } else if (ruleInput.trigger_type.startsWith("reservation.")) {
      tableName = "reservations";
    }

    const sampleRes = await tx.query(
      `SELECT * FROM ${tableName}
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [context.organizationId, sampleLimit],
    );

    const records = sampleRes.rows;
    const conditions = ruleInput.conditions || [];
    const matchingEntityIds: string[] = [];

    for (const record of records) {
      if (evaluateAllConditions(record, conditions)) {
        matchingEntityIds.push(record.id);
      }
    }

    const matchedCount = matchingEntityIds.length;
    const simulatedActions = (ruleInput.actions || []).map((action) => ({
      action_type: action.action_type,
      targetCount: matchedCount,
      description: `Would execute [${action.action_type}] on ${matchedCount} matching records`,
    }));

    return {
      ruleName: ruleInput.name,
      triggerType: ruleInput.trigger_type,
      totalSampled: records.length,
      matchedCount,
      matchingEntityIds,
      simulatedActions,
    };
  });
}
