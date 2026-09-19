import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";

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
 */
export async function createTask(
  context: TenantContext,
  input: CreateTaskInput,
) {
  // Salesperson can create tasks for themselves, managers can create for anyone
  if (
    context.role === "SALESPERSON" &&
    input.assignedUserId !== context.userId
  ) {
    input.assignedUserId = context.userId;
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `INSERT INTO tasks (
        organization_id, lead_id, assigned_user_id, title,
        description, due_date, priority, is_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false)
      RETURNING *`,
      [
        context.organizationId,
        input.leadId || null,
        input.assignedUserId,
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
 */
export async function completeTask(context: TenantContext, taskId: string) {
  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query("SELECT * FROM tasks WHERE id = $1", [
      taskId,
    ]);
    if (existing.rows.length === 0) {
      throw new Error("Task not found");
    }

    const task = existing.rows[0];
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
