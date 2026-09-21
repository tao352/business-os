import type {
  LeadClosureReason,
  LeadStatus,
  TenantContext,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import type { TransactionClient } from "./audit-helper.js";

export interface LeadStageTransitionOptions {
  lostReasonCode?: LeadClosureReason;
  lostReasonNotes?: string | null;
  metadata?: Record<string, unknown>;
  enforceTransition?: boolean;
  authorizeUpdate?: boolean;
}

export interface LeadStageTransitionResult {
  previousLead: Record<string, unknown>;
  lead: Record<string, unknown>;
  previousStatus: LeadStatus;
  newStatus: LeadStatus;
  changed: boolean;
  reasonCode: LeadClosureReason | null;
  reasonNotes: string | null;
}

export const ALLOWED_LEAD_STATUS_TRANSITIONS: Record<
  LeadStatus,
  readonly LeadStatus[]
> = {
  NEW: [
    "CONTACTED",
    "QUALIFIED",
    "MEETING_SCHEDULED",
    "SITE_VISIT_BOOKED",
    "UNQUALIFIED",
    "LOST",
  ],
  CONTACTED: [
    "QUALIFIED",
    "MEETING_SCHEDULED",
    "SITE_VISIT_BOOKED",
    "UNQUALIFIED",
    "LOST",
  ],
  QUALIFIED: [
    "CONTACTED",
    "MEETING_SCHEDULED",
    "SITE_VISIT_BOOKED",
    "RESERVED",
    "UNQUALIFIED",
    "LOST",
  ],
  MEETING_SCHEDULED: [
    "CONTACTED",
    "QUALIFIED",
    "SITE_VISIT_BOOKED",
    "UNQUALIFIED",
    "LOST",
  ],
  SITE_VISIT_BOOKED: [
    "CONTACTED",
    "QUALIFIED",
    "RESERVED",
    "UNQUALIFIED",
    "LOST",
  ],
  RESERVED: ["QUALIFIED", "SITE_VISIT_BOOKED", "CONTRACTED", "LOST"],
  CONTRACTED: [],
  UNQUALIFIED: ["CONTACTED", "QUALIFIED"],
  LOST: ["CONTACTED", "QUALIFIED"],
};

/**
 * Records the authoritative initial pipeline stage for a newly-created Lead.
 *
 * Call this in the SAME transaction that inserts the Lead. Keeping the insert and
 * lifecycle baseline atomic prevents externally-created Leads (imports/webhooks)
 * from existing without stage history.
 */
export async function recordInitialLeadStageInTransaction(
  tx: TransactionClient,
  context: TenantContext,
  leadId: string,
  status: LeadStatus,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO lead_stage_history (
      organization_id,
      lead_id,
      from_status,
      to_status,
      changed_by_user_id,
      metadata
    ) VALUES ($1, $2, NULL, $3, $4, $5)`,
    [
      context.organizationId,
      leadId,
      status,
      context.userId,
      JSON.stringify(metadata),
    ],
  );
}

/**
 * Applies every Lead pipeline invariant inside an existing tenant transaction.
 *
 * This is the single low-level status transition primitive. Parent domain
 * operations (reservation, contract, visit, automation) may call it after their
 * own authorization checks by leaving authorizeUpdate=false. Direct CRM updates
 * should set authorizeUpdate=true.
 *
 * It intentionally does NOT write timeline activities or audit logs; callers own
 * those use-case-specific side effects. The lifecycle invariants below are always
 * applied atomically:
 * - row lock
 * - optional transition validation
 * - stage-entered timestamp
 * - closure metadata
 * - immutable stage history
 */
export async function transitionLeadStageInTransaction(
  tx: TransactionClient,
  context: TenantContext,
  leadId: string,
  newStatus: LeadStatus,
  options: LeadStageTransitionOptions = {},
): Promise<LeadStageTransitionResult> {
  const existing = await tx.query(
    `SELECT *
     FROM leads
     WHERE organization_id = $1 AND id = $2
     FOR UPDATE`,
    [context.organizationId, leadId],
  );

  const lead = existing.rows[0] as Record<string, unknown> | undefined;
  if (!lead) {
    throw new Error("Lead not found");
  }

  if (options.authorizeUpdate) {
    assertPermission(context, "update", "lead", lead);
  }

  const oldStatus = lead.status as LeadStatus;
  if (oldStatus === newStatus) {
    return {
      previousLead: lead,
      lead,
      previousStatus: oldStatus,
      newStatus,
      changed: false,
      reasonCode: (lead.lost_reason_code as LeadClosureReason | null) ?? null,
      reasonNotes: (lead.lost_reason_notes as string | null) ?? null,
    };
  }

  const enforceTransition = options.enforceTransition ?? true;
  if (
    enforceTransition &&
    !ALLOWED_LEAD_STATUS_TRANSITIONS[oldStatus].includes(newStatus)
  ) {
    throw new Error(
      `Invalid lead pipeline transition from '${oldStatus}' to '${newStatus}'`,
    );
  }

  const isClosing = newStatus === "LOST" || newStatus === "UNQUALIFIED";
  const reasonCode: LeadClosureReason | null = isClosing
    ? (options.lostReasonCode ?? "UNSPECIFIED")
    : null;
  const reasonNotes = isClosing
    ? options.lostReasonNotes?.trim() || null
    : null;

  const updated = await tx.query(
    `UPDATE leads
     SET status = $1,
         pipeline_stage_entered_at = NOW(),
         lost_reason_code = $2,
         lost_reason_notes = $3,
         closed_at = CASE WHEN $4::boolean THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE organization_id = $5 AND id = $6
     RETURNING *`,
    [
      newStatus,
      reasonCode,
      reasonNotes,
      isClosing,
      context.organizationId,
      leadId,
    ],
  );

  const updatedLead = updated.rows[0] as Record<string, unknown>;

  await tx.query(
    `INSERT INTO lead_stage_history (
      organization_id,
      lead_id,
      from_status,
      to_status,
      changed_by_user_id,
      reason_code,
      reason_notes,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.organizationId,
      leadId,
      oldStatus,
      newStatus,
      context.userId,
      reasonCode,
      reasonNotes,
      JSON.stringify(options.metadata ?? { source: "internal_transition" }),
    ],
  );

  return {
    previousLead: lead,
    lead: updatedLead,
    previousStatus: oldStatus,
    newStatus,
    changed: true,
    reasonCode,
    reasonNotes,
  };
}
