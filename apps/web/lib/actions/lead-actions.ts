"use server";

import { revalidatePath } from "next/cache";
import type { LeadStatus } from "@business-os/types";
import {
  createLead,
  updateLeadStatus,
  assignLead,
  logActivity,
  createTask,
  completeTask,
  type TaskPriority,
} from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server Action: Creates a new lead.
 */
export async function createLeadAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const fullName = formData.get("fullName") as string;
    const phone = formData.get("phone") as string;
    const email = (formData.get("email") as string) || undefined;
    const source = (formData.get("source") as string) || "MANUAL";
    const assignedUserId =
      (formData.get("assignedUserId") as string) || undefined;

    if (!fullName || !fullName.trim()) {
      return { success: false, error: "Full name is required" };
    }
    if (!phone || !phone.trim()) {
      return { success: false, error: "Phone number is required" };
    }

    const lead = await createLead(context, {
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      source: source.trim(),
      assignedUserId: assignedUserId || null,
      status: "NEW",
    });

    revalidatePath("/app");
    revalidatePath("/app/leads");

    return { success: true, data: lead };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create lead";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Updates a lead's operational status.
 */
export async function updateLeadStatusAction(
  leadId: string,
  newStatus: LeadStatus,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    if (!leadId) {
      return { success: false, error: "Lead ID is required" };
    }

    const updated = await updateLeadStatus(context, leadId, newStatus);

    revalidatePath("/app");
    revalidatePath("/app/leads");
    revalidatePath(`/app/leads/${leadId}`);

    return { success: true, data: updated };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update lead status";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Reassigns a lead to a sales agent.
 */
export async function assignLeadAction(
  leadId: string,
  targetUserId: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    if (!leadId || !targetUserId) {
      return { success: false, error: "Lead ID and target agent are required" };
    }

    const updated = await assignLead(context, leadId, targetUserId);

    revalidatePath("/app/leads");
    revalidatePath(`/app/leads/${leadId}`);

    return { success: true, data: updated };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to assign lead";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Appends a manual note to the lead timeline.
 */
export async function addLeadNoteAction(
  leadId: string,
  content: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    if (!leadId) {
      return { success: false, error: "Lead ID is required" };
    }
    if (!content || !content.trim()) {
      return { success: false, error: "Note content cannot be empty" };
    }

    const activity = await logActivity(context, {
      leadId,
      activityType: "NOTE",
      summary: content.trim(),
    });

    revalidatePath("/app");
    revalidatePath(`/app/leads/${leadId}`);

    return { success: true, data: activity };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add note";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Schedules a follow-up task for a lead.
 */
export async function createFollowupTaskAction(
  leadId: string,
  title: string,
  dueDate: string,
  priority: TaskPriority = "MEDIUM",
  description?: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    if (!title || !title.trim()) {
      return { success: false, error: "Task title is required" };
    }
    if (!dueDate) {
      return { success: false, error: "Due date is required" };
    }

    const task = await createTask(context, {
      leadId,
      assignedUserId: context.userId,
      title: title.trim(),
      dueDate,
      priority,
      description: description?.trim(),
    });

    revalidatePath("/app");
    revalidatePath(`/app/leads/${leadId}`);

    return { success: true, data: task };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create task";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Marks a follow-up task as complete.
 */
export async function completeTaskAction(
  taskId: string,
  leadId?: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    if (!taskId) {
      return { success: false, error: "Task ID is required" };
    }

    const task = await completeTask(context, taskId);

    revalidatePath("/app");
    if (leadId) {
      revalidatePath(`/app/leads/${leadId}`);
    }

    return { success: true, data: task };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to complete task";
    return { success: false, error: message };
  }
}
