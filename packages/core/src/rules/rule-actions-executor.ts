import type { TenantContext, RuleAction } from "@business-os/types";
import type { TransactionClient } from "../crm/audit-helper.js";

export interface ActionExecutionResult {
  action_type: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Executes a single RuleAction against a target entity within an existing tenant transaction.
 */
export async function executeRuleAction(
  tx: TransactionClient,
  context: TenantContext,
  ruleId: string,
  action: RuleAction,
  entityType: string,
  entity: Record<string, unknown>,
): Promise<ActionExecutionResult> {
  const entityId = String(entity.id);

  try {
    switch (action.action_type) {
      case "lead.assign_round_robin": {
        if (entityType !== "lead") {
          return {
            action_type: action.action_type,
            status: "SKIPPED",
            error: "Action only applies to leads",
          };
        }

        const candidateIds: string[] =
          Array.isArray(action.params.user_ids) &&
          action.params.user_ids.length > 0
            ? action.params.user_ids.map(String)
            : [];

        let candidates: Array<{ id: string; full_name: string }> = [];

        if (candidateIds.length > 0) {
          const res = await tx.query(
            `SELECT u.id, u.full_name FROM users u
             JOIN organization_memberships om ON om.user_id = u.id
             WHERE om.organization_id = $1 AND u.id = ANY($2) AND om.is_active = true`,
            [context.organizationId, candidateIds],
          );
          const byId = new Map(
            res.rows.map((r: { id: string; full_name: string }) => [r.id, r]),
          );
          candidates = candidateIds
            .map((id) => byId.get(id))
            .filter(
              (c): c is { id: string; full_name: string } => c !== undefined,
            );
        } else {
          const res = await tx.query(
            `SELECT u.id, u.full_name FROM users u
             JOIN organization_memberships om ON om.user_id = u.id
             WHERE om.organization_id = $1 AND om.is_active = true
               AND om.role IN ('SALESPERSON', 'SALES_MANAGER', 'ADMIN', 'OWNER')
             ORDER BY u.id ASC`,
            [context.organizationId],
          );
          candidates = res.rows;
        }

        if (candidates.length === 0) {
          return {
            action_type: action.action_type,
            status: "FAILED",
            error: "No eligible users found for round-robin assignment",
          };
        }

        // Get last assigned user
        const stateRes = await tx.query(
          `SELECT last_assigned_user_id FROM round_robin_state
           WHERE organization_id = $1 AND rule_id = $2`,
          [context.organizationId, ruleId],
        );

        const lastUserId = stateRes.rows[0]?.last_assigned_user_id;
        let nextIndex = 0;

        if (lastUserId) {
          const lastIdx = candidates.findIndex((c) => c.id === lastUserId);
          if (lastIdx !== -1) {
            nextIndex = (lastIdx + 1) % candidates.length;
          }
        }

        const assignedUser = candidates[nextIndex]!;

        // Update Lead
        await tx.query(
          `UPDATE leads SET assigned_user_id = $1, updated_at = NOW() WHERE id = $2`,
          [assignedUser.id, entityId],
        );
        entity.assigned_user_id = assignedUser.id;

        // Update Round Robin State
        await tx.query(
          `INSERT INTO round_robin_state (organization_id, rule_id, last_assigned_user_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (organization_id, rule_id) DO UPDATE SET
             last_assigned_user_id = EXCLUDED.last_assigned_user_id,
             updated_at = NOW()`,
          [context.organizationId, ruleId, assignedUser.id],
        );

        // Append Timeline Activity
        await tx.query(
          `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
           VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
          [
            context.organizationId,
            entityId,
            context.userId,
            `Lead assigned via Round-Robin to ${assignedUser.full_name}`,
            JSON.stringify({
              ruleId,
              assignedUserId: assignedUser.id,
              assignedUserName: assignedUser.full_name,
            }),
          ],
        );

        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: {
            assignedUserId: assignedUser.id,
            assignedUserName: assignedUser.full_name,
          },
        };
      }

      case "lead.assign_specific_user": {
        if (entityType !== "lead") {
          return {
            action_type: action.action_type,
            status: "SKIPPED",
            error: "Action only applies to leads",
          };
        }
        const targetUserId = String(action.params.user_id);

        const userRes = await tx.query(
          `SELECT full_name FROM users WHERE id = $1`,
          [targetUserId],
        );
        const userName = userRes.rows[0]?.full_name || "Agent";

        await tx.query(
          `UPDATE leads SET assigned_user_id = $1, updated_at = NOW() WHERE id = $2`,
          [targetUserId, entityId],
        );
        entity.assigned_user_id = targetUserId;

        await tx.query(
          `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
           VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
          [
            context.organizationId,
            entityId,
            context.userId,
            `Lead assigned to ${userName} via Automation`,
            JSON.stringify({ ruleId, assignedUserId: targetUserId }),
          ],
        );

        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: { assignedUserId: targetUserId },
        };
      }

      case "lead.change_status": {
        if (entityType !== "lead") {
          return {
            action_type: action.action_type,
            status: "SKIPPED",
            error: "Action only applies to leads",
          };
        }
        const newStatus = String(action.params.status || "CONTACTED");

        await tx.query(
          `UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, entityId],
        );
        entity.status = newStatus;

        await tx.query(
          `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
           VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
          [
            context.organizationId,
            entityId,
            context.userId,
            `Lead status changed to ${newStatus} via Automation`,
            JSON.stringify({ ruleId, newStatus }),
          ],
        );

        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: { newStatus },
        };
      }

      case "task.create": {
        const title = String(action.params.title || "Follow-up Reminder");
        const description = action.params.description
          ? String(action.params.description)
          : null;
        const priority = String(action.params.priority || "HIGH");
        const dueInHours =
          typeof action.params.due_in_hours === "number"
            ? action.params.due_in_hours
            : 2;

        const assignedUserId =
          (entity.assigned_user_id as string) || context.userId;
        const leadId = entityType === "lead" ? entityId : null;

        const taskRes = await tx.query(
          `INSERT INTO tasks (
            organization_id, lead_id, assigned_user_id, title, description,
            due_date, priority
          ) VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval, $7)
          RETURNING id, due_date`,
          [
            context.organizationId,
            leadId,
            assignedUserId,
            title,
            description,
            String(dueInHours),
            priority,
          ],
        );

        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: {
            taskId: taskRes.rows[0].id,
            dueDate: taskRes.rows[0].due_date,
          },
        };
      }

      case "notification.internal": {
        const summary = String(
          action.params.summary || "Automation Notification",
        );
        if (entityType === "lead") {
          await tx.query(
            `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
             VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
            [
              context.organizationId,
              entityId,
              context.userId,
              summary,
              JSON.stringify({ ruleId, ...action.params }),
            ],
          );
        }
        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: { summary },
        };
      }

      case "whatsapp.send_template": {
        // Will be connected to WhatsApp engine in Phase 11
        return {
          action_type: action.action_type,
          status: "SUCCESS",
          result: { templateName: action.params.template_name, queued: true },
        };
      }

      default:
        return {
          action_type: action.action_type,
          status: "FAILED",
          error: `Unknown action type: ${(action as any).action_type}`,
        };
    }
  } catch (err: any) {
    return {
      action_type: action.action_type,
      status: "FAILED",
      error: err.message || String(err),
    };
  }
}
