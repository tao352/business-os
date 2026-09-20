import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  assertPermission,
  assertCanAccessIndividualLeadRecords,
} from "../permissions/checker.js";
import { getLead } from "./lead-service.js";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface CreateTaskInput {
  leadId?: string | null;
  assignedUserId: string;
  title: string;
  description?: string;
  dueDate: string;
  priority?: TaskPriority;
}

export interface ListTasksFilters {
  leadId?: string;
  assignedUserId?: string;
  isCompleted?: boolean;
}

/**
 * Creates a follow-up task with a deadline.
 * Enforces lead update permission, row-level ownership, and active assignee membership.
 */
export async function createTask(
  context: TenantContext,
  input: CreateTaskInput,
) {
  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. If associated with a lead, verify lead exists and assert row-level update permission
    if (input.leadId) {
      assertCanAccessIndividualLeadRecords(context);
      const leadRes = await tx.query("SELECT * FROM leads WHERE id = $1", [
        input.leadId,
      ]);
      if (leadRes.rows.length === 0) {
        throw new Error("Lead not found");
      }
      const targetLead = leadRes.rows[0];
      assertPermission(context, "update", "lead", targetLead);
    } else {
      assertPermission(context, "update", "lead");
    }

    // 2. Salesperson can create tasks for themselves, managers can create for anyone
    let effectiveAssignee = input.assignedUserId;
    if (context.role === "SALESPERSON") {
      effectiveAssignee = context.userId;
    }

    // 3. Verify assignee is an active member of this organization
    const userRes = await tx.query(
      `SELECT u.id
       FROM users u
       JOIN organization_memberships m ON m.user_id = u.id
       WHERE u.id = $1 AND m.organization_id = $2 AND m.is_active = true AND u.is_active = true`,
      [effectiveAssignee, context.organizationId],
    );
    if (userRes.rows.length === 0) {
      throw new Error(
        "Assigned user is not an active member of this organization",
      );
    }

    const res = await tx.query(
      `INSERT INTO tasks (
        organization_id, lead_id, assigned_user_id, title,
        description, due_date, priority, is_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false)
      RETURNING *`,
      [
        context.organizationId,
        input.leadId || null,
        effectiveAssignee,
        input.title.trim(),
        input.description?.trim() || null,
        input.dueDate,
        input.priority || "MEDIUM",
      ],
    );

    return res.rows[0];
  });
}

/**
 * Lists tasks enforcing assignment constraints for SALESPERSON.
 */
export async function listTasks(
  context: TenantContext,
  filters: ListTasksFilters = {},
) {
  // MARKETING_USER is restricted to aggregate metrics only
  if (context.role === "MARKETING_USER") {
    return [];
  }

  // If tasks for a specific lead are requested, assert lead access and ownership
  if (filters.leadId) {
    assertCanAccessIndividualLeadRecords(context);
    await getLead(context, filters.leadId);
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ["1 = 1"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (context.role === "SALESPERSON") {
      conditions.push(`assigned_user_id = $${paramIdx++}`);
      params.push(context.userId);
    } else if (filters.assignedUserId) {
      conditions.push(`assigned_user_id = $${paramIdx++}`);
      params.push(filters.assignedUserId);
    }

    if (filters.leadId) {
      conditions.push(`lead_id = $${paramIdx++}`);
      params.push(filters.leadId);
    }

    if (typeof filters.isCompleted === "boolean") {
      conditions.push(`is_completed = $${paramIdx++}`);
      params.push(filters.isCompleted);
    }

    const query = `
      SELECT t.*, u.full_name as assignee_name
      FROM tasks t
      JOIN users u ON u.id = t.assigned_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.is_completed ASC, t.due_date ASC
    `;

    const res = await tx.query(query, params);
    return res.rows;
  });
}

/**
 * Marks a task as completed.
 * Enforces lead update authorization, role boundaries, and salesperson task ownership.
 */
export async function completeTask(context: TenantContext, taskId: string) {
  // Reject roles without lead update capability (e.g. READ_ONLY, MARKETING_USER)
  assertPermission(context, "update", "lead");

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query("SELECT * FROM tasks WHERE id = $1", [
      taskId,
    ]);
    if (existing.rows.length === 0) {
      throw new Error("Task not found");
    }

    const task = existing.rows[0];

    // If associated with a lead, verify row-level lead authorization
    if (task.lead_id) {
      const leadRes = await tx.query("SELECT * FROM leads WHERE id = $1", [
        task.lead_id,
      ]);
      if (leadRes.rows.length > 0) {
        assertPermission(context, "update", "lead", leadRes.rows[0]);
      }
    }

    // Salesperson can only complete tasks assigned to themselves
    if (
      context.role === "SALESPERSON" &&
      task.assigned_user_id !== context.userId
    ) {
      throw new Error("Cannot complete tasks assigned to other agents");
    }

    const res = await tx.query(
      `UPDATE tasks
       SET is_completed = true, completed_at = NOW(), completed_by_user_id = $1
       WHERE id = $2
       RETURNING *`,
      [context.userId, taskId],
    );

    return res.rows[0];
  });
}
