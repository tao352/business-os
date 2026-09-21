import { withTenantContext } from "@business-os/database";
import type { LeadStatus, TenantContext } from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";

export type LeadFollowUpHealthState =
  "HEALTHY" | "NO_NEXT_ACTION" | "OVERDUE_NEXT_ACTION" | "STALE_CONTACT";

export interface LeadFollowUpHealthRow {
  leadId: string;
  fullName: string;
  status: LeadStatus;
  assignedUserId: string | null;
  lastContactedAt: string | Date | null;
  pipelineStageEnteredAt: string | Date;
  nextActionId: string | null;
  nextActionTitle: string | null;
  nextActionAt: string | Date | null;
  health: LeadFollowUpHealthState;
}

export interface ListLeadFollowUpHealthOptions {
  assignedUserId?: string;
  staleAfterHours?: number;
  limit?: number;
  health?: Exclude<LeadFollowUpHealthState, "HEALTHY">;
}

/**
 * Computes operational follow-up health without introducing a second source of truth.
 *
 * The earliest incomplete Task is the Lead's "next action". This keeps follow-up
 * scheduling centralized in the existing Tasks domain instead of duplicating it on Leads.
 */
export async function listLeadFollowUpHealth(
  context: TenantContext,
  options: ListLeadFollowUpHealthOptions = {},
): Promise<LeadFollowUpHealthRow[]> {
  assertCanAccessIndividualLeadRecords(context);
  assertPermission(context, "read", "lead");

  const staleAfterHours = Math.min(
    Math.max(Math.trunc(options.staleAfterHours ?? 24), 1),
    720,
  );
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 200);

  return await withTenantContext(context.organizationId, async (tx) => {
    const params: unknown[] = [context.organizationId, staleAfterHours, limit];
    const conditions: string[] = [
      "l.organization_id = $1",
      "l.status NOT IN ('CONTRACTED', 'UNQUALIFIED', 'LOST')",
    ];

    let nextParam = 4;
    if (context.role === "SALESPERSON") {
      conditions.push(`l.assigned_user_id = $${nextParam++}`);
      params.push(context.userId);
    } else if (options.assignedUserId) {
      conditions.push(`l.assigned_user_id = $${nextParam++}`);
      params.push(options.assignedUserId);
    }

    const healthExpression = `
      CASE
        WHEN next_task.id IS NOT NULL AND next_task.due_date <= NOW()
          THEN 'OVERDUE_NEXT_ACTION'
        WHEN next_task.id IS NULL
          THEN 'NO_NEXT_ACTION'
        WHEN COALESCE(l.last_contacted_at, l.created_at)
             <= NOW() - ($2::int * INTERVAL '1 hour')
          THEN 'STALE_CONTACT'
        ELSE 'HEALTHY'
      END
    `;

    if (options.health) {
      conditions.push(`(${healthExpression}) = $${nextParam++}`);
      params.push(options.health);
    }

    const result = await tx.query(
      `SELECT
         l.id AS lead_id,
         l.full_name,
         l.status,
         l.assigned_user_id,
         l.last_contacted_at,
         l.pipeline_stage_entered_at,
         next_task.id AS next_action_id,
         next_task.title AS next_action_title,
         next_task.due_date AS next_action_at,
         ${healthExpression} AS health
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT t.id, t.title, t.due_date
         FROM tasks t
         WHERE t.organization_id = l.organization_id
           AND t.lead_id = l.id
           AND t.is_completed = FALSE
         ORDER BY t.due_date ASC, t.created_at ASC
         LIMIT 1
       ) next_task ON TRUE
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE ${healthExpression}
           WHEN 'OVERDUE_NEXT_ACTION' THEN 1
           WHEN 'NO_NEXT_ACTION' THEN 2
           WHEN 'STALE_CONTACT' THEN 3
           ELSE 4
         END,
         COALESCE(next_task.due_date, l.updated_at) ASC
       LIMIT $3`,
      params,
    );

    return result.rows.map((row) => ({
      leadId: row.lead_id,
      fullName: row.full_name,
      status: row.status,
      assignedUserId: row.assigned_user_id,
      lastContactedAt: row.last_contacted_at,
      pipelineStageEnteredAt: row.pipeline_stage_entered_at,
      nextActionId: row.next_action_id,
      nextActionTitle: row.next_action_title,
      nextActionAt: row.next_action_at,
      health: row.health,
    })) as LeadFollowUpHealthRow[];
  });
}
