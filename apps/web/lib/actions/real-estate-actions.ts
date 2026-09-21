"use server";

import { revalidatePath } from "next/cache";
import {
  createProject,
  createUnit,
  createReservation,
  addLeadInterest,
  generatePaymentSchedule,
  UnitNotAvailableError,
} from "@business-os/core";
import type {
  PaymentPlanInput,
  PaymentScheduleResult,
  UnitUsageType,
  UnitType,
} from "@business-os/types";
import { requireTenantContext } from "@/lib/auth";
import {
  createProjectSchema,
  createUnitSchema,
  reserveUnitSchema,
  addLeadInterestSchema,
} from "@/lib/validations/action-schemas";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Server Action: Creates a new real estate project.
 */
export async function createProjectAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const rawInput = {
      name: formData.get("name"),
      location: formData.get("location"),
      description: formData.get("description") || undefined,
      projectType: formData.get("projectType") || "COMMERCIAL",
      constructionStatus:
        formData.get("constructionStatus") || "UNDER_CONSTRUCTION",
      salesStatus: formData.get("salesStatus") || "SELLING",
      totalUnits: formData.get("totalUnits") || 0,
    };

    const parsed = createProjectSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const project = await createProject(context, {
      name: parsed.data.name,
      location: parsed.data.location,
      description: parsed.data.description || undefined,
      projectType: parsed.data.projectType,
      constructionStatus: parsed.data.constructionStatus,
      salesStatus: parsed.data.salesStatus,
      totalUnits: parsed.data.totalUnits,
    });

    revalidatePath("/app/projects");
    revalidatePath("/app/units");
    return { success: true, data: project };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create project";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Creates a new inventory unit.
 */
export async function createUnitAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const rawInput = {
      projectId: formData.get("projectId"),
      unitNumber: formData.get("unitNumber"),
      usageType: formData.get("usageType") || "COMMERCIAL",
      unitType: formData.get("unitType") || "RETAIL_STORE",
      modelName: formData.get("modelName") || undefined,
      floor: formData.get("floor") || undefined,
      grossArea: formData.get("grossArea"),
      price: formData.get("price"),
      currency: formData.get("currency") || "EGP",
    };

    const parsed = createUnitSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    const unit = await createUnit(context, {
      projectId: parsed.data.projectId,
      unitNumber: parsed.data.unitNumber,
      usageType: parsed.data.usageType,
      unitType: parsed.data.unitType,
      modelName: parsed.data.modelName || undefined,
      floor: parsed.data.floor || undefined,
      grossArea: parsed.data.grossArea,
      price: parsed.data.price,
      currency: parsed.data.currency,
      status: "AVAILABLE",
    });

    revalidatePath("/app/projects");
    revalidatePath("/app/units");
    return { success: true, data: unit };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create unit";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Places a unit reservation for a lead.
 * Gracefully catches UnitNotAvailableError and concurrent locking collisions.
 */
export async function reserveUnitAction(rawInput: {
  leadId: string;
  unitId: string;
  depositAmount: number;
  currency?: string;
  expiresAt: string;
  paymentMethod?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = reserveUnitSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid reservation input",
      };
    }

    const reservation = await createReservation(context, {
      leadId: parsed.data.leadId,
      unitId: parsed.data.unitId,
      depositAmount: parsed.data.depositAmount,
      currency: parsed.data.currency,
      expiresAt: parsed.data.expiresAt,
      paymentMethod: parsed.data.paymentMethod || undefined,
      notes: parsed.data.notes || undefined,
    });

    revalidatePath("/app/units");
    revalidatePath(`/app/leads/${parsed.data.leadId}`);
    revalidatePath("/app/leads");
    return { success: true, data: reservation };
  } catch (err: unknown) {
    if (err instanceof UnitNotAvailableError) {
      return {
        success: false,
        error: `Unit is already ${err.currentStatus} and cannot be reserved.`,
      };
    }
    const message =
      err instanceof Error ? err.message : "Failed to reserve unit";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Adds a property interest to a lead's 1:N interests wishlist.
 */
export async function addLeadInterestAction(data: {
  leadId: string;
  projectId?: string | null;
  specificUnitId?: string | null;
  usageType?: UnitUsageType | null;
  unitType?: UnitType | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  isPrimary?: boolean;
  notes?: string | null;
}): Promise<ActionResult> {
  try {
    const context = await requireTenantContext();

    const parsed = addLeadInterestSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid interest data",
      };
    }

    const created = await addLeadInterest(context, {
      leadId: parsed.data.leadId,
      projectId: parsed.data.projectId || null,
      specificUnitId: parsed.data.specificUnitId || null,
      usageType: parsed.data.usageType || null,
      unitType: parsed.data.unitType || null,
      budgetMin: parsed.data.budgetMin ?? null,
      budgetMax: parsed.data.budgetMax ?? null,
      areaMin: parsed.data.areaMin ?? null,
      areaMax: parsed.data.areaMax ?? null,
      isPrimary: parsed.data.isPrimary ?? true,
      notes: parsed.data.notes || null,
    });

    revalidatePath(`/app/leads/${parsed.data.leadId}`);
    return { success: true, data: created };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to add lead property interest";
    return { success: false, error: message };
  }
}

/**
 * Server Action: Authoritative payment schedule calculation.
 * Zero browser math — computed purely by domain engine.
 */
export async function calculatePaymentPlanAction(
  input: PaymentPlanInput,
): Promise<ActionResult<PaymentScheduleResult>> {
  try {
    const schedule = generatePaymentSchedule(input);
    return { success: true, data: schedule };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate payment plan";
    return { success: false, error: message };
  }
}
