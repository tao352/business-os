import { withTenantContext } from "@business-os/database";
import {
  LeadStatusSchema,
  type TenantContext,
  type SmartRule,
  type CreateRuleInput,
  type UpdateRuleInput,
  type TriggerType,
  type RuleAction,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";

function assertRuleActionsValid(actions: RuleAction[]): void {
  for (const action of actions) {
    if (action.action_type !== "lead.change_status") continue;

    const parsed = LeadStatusSchema.safeParse(
      action.params.status ?? "CONTACTED",
    );
    if (!parsed.success) {
      throw new Error(
        `Invalid Lead status configured for automation: '${String(
          action.params.status,
        )}'`,
      );
    }
  }
}

/**
 * Creates a new Smart Rule within the tenant context.
 */
export async function createRule(
  context: TenantContext,
  input: CreateRuleInput,
): Promise<SmartRule> {
  assertPermission(context, "manage", "organization");
  assertRuleActionsValid(input.actions);

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `INSERT INTO automation_rules (
        organization_id, name, description, trigger_type,
        conditions, actions, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        context.organizationId,
        input.name.trim(),
        input.description || null,
        input.trigger_type,
        JSON.stringify(input.conditions || []),
        JSON.stringify(input.actions),
        input.is_active ?? true,
      ],
    );

    const row = res.rows[0];
    return mapRuleRow(row);
  });
}

/**
 * Retrieves a Smart Rule by ID.
 */
export async function getRule(
  context: TenantContext,
  ruleId: string,
): Promise<SmartRule> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT * FROM automation_rules WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, ruleId],
    );

    if (res.rows.length === 0) {
      throw new Error(`Rule [${ruleId}] not found`);
    }

    return mapRuleRow(res.rows[0]);
  });
}

/**
 * Updates an existing Smart Rule.
 */
export async function updateRule(
  context: TenantContext,
  ruleId: string,
  input: UpdateRuleInput,
): Promise<SmartRule> {
  assertPermission(context, "manage", "organization");
  if (input.actions) {
    assertRuleActionsValid(input.actions);
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const existingRes = await tx.query(
      `SELECT * FROM automation_rules WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, ruleId],
    );

    if (existingRes.rows.length === 0) {
      throw new Error(`Rule [${ruleId}] not found`);
    }

    const current = existingRes.rows[0];
    const name = input.name !== undefined ? input.name.trim() : current.name;
    const description =
      input.description !== undefined ? input.description : current.description;
    const triggerType =
      input.trigger_type !== undefined
        ? input.trigger_type
        : current.trigger_type;
    const conditions =
      input.conditions !== undefined
        ? JSON.stringify(input.conditions)
        : JSON.stringify(current.conditions);
    const actions =
      input.actions !== undefined
        ? JSON.stringify(input.actions)
        : JSON.stringify(current.actions);
    const isActive =
      input.is_active !== undefined ? input.is_active : current.is_active;

    const res = await tx.query(
      `UPDATE automation_rules SET
        name = $1, description = $2, trigger_type = $3,
        conditions = $4, actions = $5, is_active = $6,
        version = version + 1, updated_at = NOW()
       WHERE organization_id = $7 AND id = $8
       RETURNING *`,
      [
        name,
        description,
        triggerType,
        conditions,
        actions,
        isActive,
        context.organizationId,
        ruleId,
      ],
    );

    return mapRuleRow(res.rows[0]);
  });
}

/**
 * Deletes a Smart Rule.
 */
export async function deleteRule(
  context: TenantContext,
  ruleId: string,
): Promise<boolean> {
  assertPermission(context, "manage", "organization");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `DELETE FROM automation_rules WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, ruleId],
    );

    return (res.rowCount ?? 0) > 0;
  });
}

/**
 * Lists Smart Rules with optional trigger filter.
 */
export async function listRules(
  context: TenantContext,
  triggerType?: TriggerType,
): Promise<SmartRule[]> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const query = triggerType
      ? `SELECT * FROM automation_rules WHERE organization_id = $1 AND trigger_type = $2 ORDER BY created_at DESC`
      : `SELECT * FROM automation_rules WHERE organization_id = $1 ORDER BY created_at DESC`;
    const params = triggerType
      ? [context.organizationId, triggerType]
      : [context.organizationId];

    const res = await tx.query(query, params);
    return res.rows.map(mapRuleRow);
  });
}

function mapRuleRow(row: any): SmartRule {
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    description: row.description,
    trigger_type: row.trigger_type,
    conditions: row.conditions || [],
    actions: row.actions || [],
    is_active: row.is_active,
    version: row.version,
    execution_count: row.execution_count,
    last_triggered_at: row.last_triggered_at
      ? new Date(row.last_triggered_at).toISOString()
      : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
