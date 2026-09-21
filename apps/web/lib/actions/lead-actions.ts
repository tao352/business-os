"use server";

import { revalidatePath } from "next/cache";
import type { LeadClosureReason, LeadStatus } from "@business-os/types";
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
import {
  createLeadSchema,
  updateLeadStatusSchema,
  assignLeadSchema,
  addNoteSchema,
  createTaskSchema,
  completeTaskSchema,
} from "@/lib/validations/action-schemas";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server Action: Creates a new lead with Zod validation.
 */
export async function createLeadAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const rawInput = {
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      email: formData.get("email") || undefined,
      source: formData.get("source") || "MANUAL",
      assignedUserId: formData.get("assignedUserId") || undefined,
    };

    const parsed = createLeadSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { fullName, phone, email, source, assignedUserId } = parsed.data;

    const lead = await createLead(context, {
      fullName,
      phone,
      email: email || null,
      source,
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
 * Server Action: Updates a lead's operational status with Zod validation.
 */
export async function updateLeadStatusAction(
  leadId: string,
  newStatus: LeadStatus,
  lostReasonCode?: LeadClosureReason,
  lostReasonNotes?: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = updateLeadStatusSchema.safeParse({
      leadId,
      newStatus,
      lostReasonCode,
      lostReasonNotes,
    });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const updated = await updateLeadStatus(
      context,
      parsed.data.leadId,
      parsed.data.newStatus,
      {
        lostReasonCode: parsed.data.lostReasonCode ?? undefined,
        lostReasonNotes: parsed.data.lostReasonNotes ?? undefined,
        metadata: { source: "web_status_dialog" },
      },
    );

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
 * Server Action: Reassigns a lead to a sales agent with Zod validation.
 */
export async function assignLeadAction(
  leadId: string,
  targetUserId: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = assignLeadSchema.safeParse({ leadId, targetUserId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const updated = await assignLead(
      context,
      parsed.data.leadId,
      parsed.data.targetUserId,
    );

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
 * Server Action: Appends a manual note to the lead timeline with Zod validation.
 */
export async function addLeadNoteAction(
  leadId: string,
  content: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = addNoteSchema.safeParse({ leadId, content });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const activity = await logActivity(context, {
      leadId: parsed.data.leadId,
      activityType: "NOTE",
      summary: parsed.data.content,
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
 * Server Action: Schedules a follow-up task for a lead with Zod validation.
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

    const parsed = createTaskSchema.safeParse({
      leadId,
      title,
      dueDate,
      priority,
      description,
    });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const task = await createTask(context, {
      leadId: parsed.data.leadId || null,
      assignedUserId: context.userId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      priority: parsed.data.priority,
      description: parsed.data.description || undefined,
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
 * Server Action: Marks a follow-up task as complete with Zod validation.
 */
export async function completeTaskAction(
  taskId: string,
  leadId?: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = completeTaskSchema.safeParse({ taskId, leadId });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const task = await completeTask(context, parsed.data.taskId);

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
