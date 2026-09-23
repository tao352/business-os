import type { TenantContext } from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";
import {
  recordAuditLog,
  type TransactionClient,
} from "../crm/audit-helper.js";

export const OPPORTUNITY_STAGES = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPEN_OPPORTUNITY_STAGES = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
] as const satisfies readonly OpportunityStage[];

export type OpenOpportunityStage = (typeof OPEN_OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_LOST_REASONS = [
  "PRICE",
  "FINANCING",
  "TIMING",
  "COMPETITOR",
  "NO_RESPONSE",
  "AVAILABILITY",
  "REQUIREMENTS_MISMATCH",
  "CUSTOMER_WITHDREW",
  "DUPLICATE",
  "OTHER",
] as const;

export type OpportunityLostReason =
  (typeof OPPORTUNITY_LOST_REASONS)[number];

export const OPPORTUNITY_TRANSITION_SOURCES = [
  "opportunity_created",
  "manual",
  "reservation_created",
  "contract_executed",
  "opportunity_reopened",
] as const;

export type OpportunityTransitionSource =
  (typeof OPPORTUNITY_TRANSITION_SOURCES)[number];

export interface OpportunityLifecycleRow {
  id: string;
  organization_id: string;
  lead_id: string;
  title: string;
  value: string | number;
  currency: string;
  stage: OpportunityStage;
  expected_close_date: string | Date | null;
  assigned_user_id: string | null;
  custom_data: Record<string, unknown>;
  stage_entered_at: string | Date | null;
  closed_at: string | Date | null;
  lost_reason_code: OpportunityLostReason | null;
  lost_reason_notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface OpportunityStageTransitionOptions {
  source: OpportunityTransitionSource;
  expectedLeadId?: string;
  authorizeUpdate?: boolean;
  lostReasonCode?: OpportunityLostReason;
  lostReasonNotes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OpportunityStageTransitionResult {
  previousOpportunity: OpportunityLifecycleRow;
  opportunity: OpportunityLifecycleRow;
  previousStage: OpportunityStage;
  newStage: OpportunityStage;
  changed: boolean;
  reasonCode: OpportunityLostReason | null;
  reasonNotes: string | null;
}

export function assertOpportunityStage(
  value: string,
): asserts value is OpportunityStage {
  if (!OPPORTUNITY_STAGES.includes(value as OpportunityStage)) {
    throw new Error(`Invalid Opportunity stage '${value}'`);
  }
}

export function assertOpportunityLostReason(
  value: string,
): asserts value is OpportunityLostReason {
  if (!OPPORTUNITY_LOST_REASONS.includes(value as OpportunityLostReason)) {
    throw new Error(`Invalid Opportunity lost reason '${value}'`);
  }
}

export function isOpenOpportunityStage(
  stage: OpportunityStage,
): stage is OpenOpportunityStage {
  return OPEN_OPPORTUNITY_STAGES.includes(stage as OpenOpportunityStage);
}

function assertRequestedTransitionShape(
  newStage: OpportunityStage,
  source: OpportunityTransitionSource,
): void {
  if (source === "reservation_created" && newStage !== "NEGOTIATION") {
    throw new Error(
      "Reservation-derived Opportunity transitions must target NEGOTIATION",
    );
  }

  if (source === "contract_executed" && newStage !== "WON") {
    throw new Error("Contract-derived Opportunity transitions must target WON");
  }

  if (
    source === "opportunity_reopened" &&
    !isOpenOpportunityStage(newStage)
  ) {
    throw new Error("A reopened Opportunity must target an open stage");
  }
}

function assertTransitionAllowed(
  oldStage: OpportunityStage,
  newStage: OpportunityStage,
  options: OpportunityStageTransitionOptions,
): void {
  if (options.source === "manual") {
    if (oldStage === "WON") {
      throw new Error("WON Opportunity is terminal in the normal sales flow");
    }
    if (oldStage === "LOST") {
      throw new Error(
        "LOST Opportunity must be reopened explicitly before changing stage",
      );
    }
    if (newStage === "LOST" && !options.lostReasonCode) {
      throw new Error("Opportunity lost reason is required");
    }
    return;
  }

  if (options.source === "reservation_created") {
    if (!isOpenOpportunityStage(oldStage)) {
      throw new Error(
        `Cannot reserve against a closed Opportunity in stage '${oldStage}'`,
      );
    }
    return;
  }

  if (options.source === "contract_executed") {
    if (oldStage === "LOST") {
      throw new Error(
        "Cannot execute a Contract against a LOST Opportunity; reopen or correct the linkage first",
      );
    }
    return;
  }

  if (options.source === "opportunity_reopened" && oldStage !== "LOST") {
    throw new Error("Only a LOST Opportunity can be reopened");
  }
}

/**
 * Records the truthful initial stage of a newly-created Opportunity.
 *
 * Call this inside the same transaction that inserts the Opportunity.
 */
export async function recordInitialOpportunityStageInTransaction(
  tx: TransactionClient,
  context: TenantContext,
  opportunity: OpportunityLifecycleRow,
  options: {
    reasonCode?: OpportunityLostReason | null;
    reasonNotes?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO opportunity_stage_history (
      organization_id,
      opportunity_id,
      from_stage,
      to_stage,
      changed_by_user_id,
      transition_source,
      reason_code,
      reason_notes,
      metadata
    ) VALUES ($1, $2, NULL, $3, $4, 'opportunity_created', $5, $6, $7)`,
    [
      context.organizationId,
      opportunity.id,
      opportunity.stage,
      context.userId,
      options.reasonCode ?? null,
      options.reasonNotes?.trim() || null,
      JSON.stringify(options.metadata ?? { source: "opportunity_created" }),
    ],
  );
}

/**
 * The single transaction-aware Opportunity stage primitive.
 *
 * Manual Sales calls set authorizeUpdate=true. Authorized parent-domain events
 * (Reservation / Contract) call it with authorizeUpdate=false after their own
 * permission checks. This allows Finance to execute a Contract and derive WON
 * without granting Finance arbitrary Sales Opportunity mutation permission.
 */
export async function transitionOpportunityStageInTransaction(
  tx: TransactionClient,
  context: TenantContext,
  opportunityId: string,
  newStage: OpportunityStage,
  options: OpportunityStageTransitionOptions,
): Promise<OpportunityStageTransitionResult> {
  assertOpportunityStage(newStage);
  assertRequestedTransitionShape(newStage, options.source);

  if (options.lostReasonCode) {
    assertOpportunityLostReason(options.lostReasonCode);
  }

  const existingRes = await tx.query(
    `SELECT
       d.*,
       l.assigned_user_id AS lead_assigned_user_id
     FROM deals d
     JOIN leads l
       ON l.organization_id = d.organization_id
      AND l.id = d.lead_id
     WHERE d.organization_id = $1 AND d.id = $2
     FOR UPDATE OF d`,
    [context.organizationId, opportunityId],
  );

  const existing = existingRes.rows[0] as
    | (OpportunityLifecycleRow & {
        lead_assigned_user_id: string | null;
      })
    | undefined;

  if (!existing) {
    throw new Error("Opportunity not found");
  }

  if (options.expectedLeadId && existing.lead_id !== options.expectedLeadId) {
    throw new Error(
      `Opportunity '${opportunityId}' does not belong to Lead '${options.expectedLeadId}'`,
    );
  }

  if (options.authorizeUpdate) {
    assertPermission(context, "update", "opportunity", {
      assigned_user_id: existing.assigned_user_id,
    });
    assertCanAccessIndividualLeadRecords(context, {
      assigned_user_id: existing.lead_assigned_user_id,
    });
  }

  const oldStage = existing.stage;

  if (oldStage === newStage) {
    return {
      previousOpportunity: existing,
      opportunity: existing,
      previousStage: oldStage,
      newStage,
      changed: false,
      reasonCode: existing.lost_reason_code,
      reasonNotes: existing.lost_reason_notes,
    };
  }

  assertTransitionAllowed(oldStage, newStage, options);

  const reasonCode =
    newStage === "LOST" ? (options.lostReasonCode ?? null) : null;
  const reasonNotes =
    newStage === "LOST" ? options.lostReasonNotes?.trim() || null : null;
  const isClosed = newStage === "WON" || newStage === "LOST";

  const updateRes = await tx.query(
    `UPDATE deals
     SET stage = $1,
         stage_entered_at = NOW(),
         closed_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
         lost_reason_code = $3,
         lost_reason_notes = $4,
         updated_at = NOW()
     WHERE organization_id = $5 AND id = $6
     RETURNING *`,
    [
      newStage,
      isClosed,
      reasonCode,
      reasonNotes,
      context.organizationId,
      opportunityId,
    ],
  );

  const updated = updateRes.rows[0] as OpportunityLifecycleRow | undefined;
  if (!updated) {
    throw new Error("Failed to update Opportunity stage");
  }

  await tx.query(
    `INSERT INTO opportunity_stage_history (
      organization_id,
      opportunity_id,
      from_stage,
      to_stage,
      changed_by_user_id,
      transition_source,
      reason_code,
      reason_notes,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      context.organizationId,
      opportunityId,
      oldStage,
      newStage,
      context.userId,
      options.source,
      reasonCode,
      reasonNotes,
      JSON.stringify({
        source: options.source,
        ...(options.metadata ?? {}),
      }),
    ],
  );

  await recordAuditLog(tx, context, {
    action: "UPDATE",
    entityType: "deal",
    entityId: opportunityId,
    beforeState: {
      stage: oldStage,
      stage_entered_at: existing.stage_entered_at,
      closed_at: existing.closed_at,
      lost_reason_code: existing.lost_reason_code,
      lost_reason_notes: existing.lost_reason_notes,
    },
    afterState: {
      stage: newStage,
      stage_entered_at: updated.stage_entered_at,
      closed_at: updated.closed_at,
      lost_reason_code: updated.lost_reason_code,
      lost_reason_notes: updated.lost_reason_notes,
      transition_source: options.source,
    },
  });

  await tx.query(
    `INSERT INTO activities (
      organization_id, lead_id, user_id, activity_type, summary, details
    ) VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
    [
      context.organizationId,
      existing.lead_id,
      context.userId,
      `Opportunity stage changed from ${oldStage} to ${newStage}`,
      JSON.stringify({
        opportunityId,
        dealId: opportunityId,
        oldStage,
        newStage,
        source: options.source,
        reasonCode,
      }),
    ],
  );

  return {
    previousOpportunity: existing,
    opportunity: updated,
    previousStage: oldStage,
    newStage,
    changed: true,
    reasonCode,
    reasonNotes,
  };
}
