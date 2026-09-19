import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  TriggerType,
  RuleExecutionRecord,
} from "@business-os/types";
import { evaluateAllConditions } from "../rules-evaluator.js";
import {
  executeRuleAction,
  ActionExecutionResult,
} from "./rule-actions-executor.js";
import type { WhatsAppApiClient } from "../whatsapp/whatsapp-client.js";

export interface TriggerRulesOptions {
  hopDepth?: number;
  isSystemAction?: boolean;
  whatsAppClient?: WhatsAppApiClient;
}

/**
 * Triggers all active Smart Rules matching a specific trigger_type within the tenant context.
 * Enforces a strict recursion guard (hopDepth <= 3) to prevent cascading infinite loops.
 */
export async function triggerRules(
  context: TenantContext,
  triggerType: TriggerType,
  entityType: string,
  entity: Record<string, unknown>,
  options: TriggerRulesOptions = {},
): Promise<RuleExecutionRecord[]> {
  const hopDepth = options.hopDepth || 1;

  if (hopDepth > 3) {
    logger.warn(
      {
        organizationId: context.organizationId,
        triggerType,
        entityId: entity.id,
        hopDepth,
      },
      "Smart Rules recursion limit reached (max 3 hops). Aborting to prevent cascade loops.",
    );
    return [
      {
        id: "aborted-recursion",
        organizationId: context.organizationId,
        ruleId: "none",
        triggerType,
        entityType,
        entityId: String(entity.id),
        actionsExecuted: [],
        status: "FAILED",
        errorMessage: "Max recursion depth exceeded (3 hops)",
        executionDurationMs: 0,
        hopDepth,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const rulesRes = await tx.query(
      `SELECT * FROM automation_rules
       WHERE organization_id = $1 AND trigger_type = $2 AND is_active = true
       ORDER BY created_at ASC`,
      [context.organizationId, triggerType],
    );

    const executions: RuleExecutionRecord[] = [];

    for (const rule of rulesRes.rows) {
      const conditions = rule.conditions || [];
      const isMatch = evaluateAllConditions(entity, conditions);

      if (!isMatch) {
        continue;
      }

      const startTime = Date.now();
      const actions = rule.actions || [];
      const executedActions: ActionExecutionResult[] = [];

      let hasFailure = false;
      const executionId = crypto.randomUUID();
      let actionIndex = 0;
      for (const action of actions) {
        const actionResult = await executeRuleAction(
          tx,
          context,
          rule.id,
          action,
          entityType,
          entity,
          { whatsAppClient: options.whatsAppClient, executionId, actionIndex },
        );
        actionIndex++;
        executedActions.push(actionResult);
        if (actionResult.status === "FAILED") {
          hasFailure = true;
        }
      }

      const durationMs = Date.now() - startTime;
      const status = hasFailure ? "FAILED" : "SUCCESS";

      // Record Execution Audit Log
      const execRes = await tx.query(
        `INSERT INTO rule_executions (
          organization_id, rule_id, trigger_type, entity_type, entity_id,
          actions_executed, status, execution_duration_ms, hop_depth
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          context.organizationId,
          rule.id,
          triggerType,
          entityType,
          String(entity.id),
          JSON.stringify(executedActions),
          status,
          durationMs,
          hopDepth,
        ],
      );

      // Increment execution counter on rule
      await tx.query(
        `UPDATE automation_rules SET
          execution_count = execution_count + 1,
          last_triggered_at = NOW()
         WHERE id = $1`,
        [rule.id],
      );

      const execRow = execRes.rows[0];
      executions.push({
        id: execRow.id,
        organizationId: execRow.organization_id,
        ruleId: execRow.rule_id,
        triggerType: execRow.trigger_type,
        entityType: execRow.entity_type,
        entityId: execRow.entity_id,
        actionsExecuted: execRow.actions_executed,
        status: execRow.status,
        errorMessage: execRow.error_message,
        executionDurationMs: execRow.execution_duration_ms,
        hopDepth: execRow.hop_depth,
        createdAt: execRow.created_at,
      });
    }

    return executions;
  });
}
