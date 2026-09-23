"use server";

import { revalidatePath } from "next/cache";
import {
  createOpportunity,
  reopenOpportunity,
  updateOpportunityStage,
  type OpenOpportunityStage,
  type OpportunityLostReason,
  type OpportunityStage,
} from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import {
  createOpportunitySchema,
  reopenOpportunitySchema,
  updateOpportunityStageSchema,
} from "@/lib/validations/action-schemas";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function createOpportunityAction(input: {
  leadId: string;
  title: string;
  value: number;
  currency?: string;
  expectedCloseDate?: string | null;
  assignedUserId?: string | null;
}): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();
    const parsed = createOpportunitySchema.safeParse(input);

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid Opportunity input",
      };
    }

    const opportunity = await createOpportunity(context, {
      leadId: parsed.data.leadId,
      title: parsed.data.title,
      value: parsed.data.value,
      currency: parsed.data.currency,
      expectedCloseDate: parsed.data.expectedCloseDate || null,
      assignedUserId: parsed.data.assignedUserId || null,
    });

    revalidatePath("/app");
    revalidatePath("/app/opportunities");
    revalidatePath(`/app/leads/${parsed.data.leadId}`);

    return { success: true, data: opportunity };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create Opportunity";
    return { success: false, error: message };
  }
}

export async function updateOpportunityStageAction(
  opportunityId: string,
  newStage: OpportunityStage,
  lostReasonCode?: OpportunityLostReason,
  lostReasonNotes?: string,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();
    const parsed = updateOpportunityStageSchema.safeParse({
      opportunityId,
      newStage,
      lostReasonCode,
      lostReasonNotes,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid stage change",
      };
    }

    const updated = await updateOpportunityStage(
      context,
      parsed.data.opportunityId,
      parsed.data.newStage,
      {
        lostReasonCode: parsed.data.lostReasonCode ?? undefined,
        lostReasonNotes: parsed.data.lostReasonNotes ?? undefined,
      },
    );

    revalidatePath("/app");
    revalidatePath("/app/opportunities");
    revalidatePath(`/app/opportunities/${opportunityId}`);
    revalidatePath(`/app/leads/${updated.lead_id}`);

    return { success: true, data: updated };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update Opportunity";
    return { success: false, error: message };
  }
}

export async function reopenOpportunityAction(
  opportunityId: string,
  targetStage: OpenOpportunityStage = "DISCOVERY",
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();
    const parsed = reopenOpportunitySchema.safeParse({
      opportunityId,
      targetStage,
    });

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid reopen request",
      };
    }

    const updated = await reopenOpportunity(
      context,
      parsed.data.opportunityId,
      parsed.data.targetStage,
    );

    revalidatePath("/app");
    revalidatePath("/app/opportunities");
    revalidatePath(`/app/opportunities/${opportunityId}`);
    revalidatePath(`/app/leads/${updated.lead_id}`);

    return { success: true, data: updated };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to reopen Opportunity";
    return { success: false, error: message };
  }
}
