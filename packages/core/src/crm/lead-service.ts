import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  LeadStatus,
  LeadClosureReason,
  LeadStageHistory,
} from "@business-os/types";
import {
  assertPermission,
  can,
  assertCanAccessIndividualLeadRecords,
} from "../permissions/checker.js";
import { assertActiveTenantMember } from "../permissions/tenant-member-guard.js";
import { recordAuditLog } from "./audit-helper.js";
import { validateCustomData } from "../metadata/custom-fields-compiler.js";

export interface CreateLeadInput {
  fullName: string;
  phone: string;
  email?: string | null;
  status?: LeadStatus;
  assignedUserId?: string | null;
  campaignId?: string | null;
  source?: string;
  customData?: Record<string, unknown>;
}

export interface ListLeadsFilters {
  status?: LeadStatus;
  assignedUserId?: string;
  campaignId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateLeadStatusOptions {
  lostReasonCode?: LeadClosureReason;
  lostReasonNotes?: string | null;
  metadata?: Record<string, unknown>;
  enforceTransition?: boolean;
}

const ALLOWED_LEAD_STATUS_TRANSITIONS: Record<
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
 * Creates a new lead with custom field validation, audit logging and an initial activity note.
 */
export async function createLead(
  context: TenantContext,
  input: CreateLeadInput,
) {
  assertPermission(context, "create", "lead");

  return await withTenantContext(context.organizationId, async (tx) => {
    const status: LeadStatus = input.status || "NEW";
    const source = input.source || "MANUAL";

    // 1. Fetch active custom field definitions and validate payload
    const defsRes = await tx.query(
      `SELECT * FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = 'lead' AND is_active = true`,
      [context.organizationId],
    );

    // If assignedUserId is provided, assert active tenant membership
    if (input.assignedUserId) {
      await assertActiveTenantMember(
        context,
        input.assignedUserId,
        undefined,
        tx,
      );
    }

    const validatedCustomData =
      defsRes.rows.length > 0
        ? validateCustomData(defsRes.rows, input.customData || {})
        : input.customData || {};

    const res = await tx.query(
      `INSERT INTO leads (
        organization_id, full_name, phone, email, status,
        assigned_user_id, campaign_id, source,
        custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        context.organizationId,
        input.fullName.trim(),
        input.phone.trim(),
        input.email?.trim() || null,
        status,
        input.assignedUserId || null,
        input.campaignId || null,
        source,
        JSON.stringify(validatedCustomData),
      ],
    );

    const lead = res.rows[0];

    // 1. Immutable Audit Log
    await recordAuditLog(tx, context, {
      action: "CREATE",
      entityType: "lead",
      entityId: lead.id,
      afterState: lead,
    });

    // 2. Initial Timeline Activity
    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        lead.id,
        context.userId,
        `Lead created via ${source}`,
        JSON.stringify({ source, campaignId: input.campaignId }),
      ],
    );

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
        lead.id,
        status,
        context.userId,
        JSON.stringify({ source: "lead_created" }),
      ],
    );

    return lead;
  });
}

/**
 * Retrieves a single lead, asserting row-level ownership if user is a SALESPERSON.
 * Rejects MARKETING_USER (restricted to aggregated metrics only).
 */
export async function getLead(context: TenantContext, leadId: string) {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query("SELECT * FROM leads WHERE id = $1", [leadId]);
    if (res.rows.length === 0) {
      throw new Error("Lead not found");
    }

    const lead = res.rows[0];
    assertPermission(context, "read", "lead", lead);

    return lead;
  });
}

/**
 * Lists individual leads with filtering, pagination, and role-based assignment constraints.
 * Rejects MARKETING_USER (restricted to aggregated metrics only).
 */
export async function listLeads(
  context: TenantContext,
  filters: ListLeadsFilters = {},
) {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ["1 = 1"];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Enforce SALESPERSON assignment constraint
    if (context.role === "SALESPERSON") {
      conditions.push(`assigned_user_id = $${paramIdx++}`);
      params.push(context.userId);
    } else if (filters.assignedUserId) {
      conditions.push(`assigned_user_id = $${paramIdx++}`);
      params.push(filters.assignedUserId);
    }

    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.campaignId) {
      conditions.push(`campaign_id = $${paramIdx++}`);
      params.push(filters.campaignId);
    }

    if (filters.search) {
      conditions.push(
        `(full_name ILIKE $${paramIdx} OR phone ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`,
      );
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const query = `
      SELECT * FROM leads
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limit, offset);

    const res = await tx.query(query, params);
    return res.rows;
  });
}

/**
 * Updates a lead's status, logging an automatic STATUS_CHANGE timeline activity.
 */
export async function updateLeadStatus(
  context: TenantContext,
  leadId: string,
  newStatus: LeadStatus,
  options: UpdateLeadStatusOptions = {},
) {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query(
      "SELECT * FROM leads WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, leadId],
    );
    if (existing.rows.length === 0) {
      throw new Error("Lead not found");
    }

    const lead = existing.rows[0];
    assertPermission(context, "update", "lead", lead);

    const oldStatus = lead.status as LeadStatus;
    if (oldStatus === newStatus) {
      return lead;
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
      ? (options.lostReasonNotes?.trim() || null)
      : null;

    const res = await tx.query(
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
    const updatedLead = res.rows[0];

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
        JSON.stringify(options.metadata ?? { source: "manual_status_change" }),
      ],
    );

    await recordAuditLog(tx, context, {
      action: "UPDATE",
      entityType: "lead",
      entityId: leadId,
      beforeState: {
        status: oldStatus,
        lost_reason_code: lead.lost_reason_code ?? null,
        closed_at: lead.closed_at ?? null,
      },
      afterState: {
        status: newStatus,
        lost_reason_code: reasonCode,
        closed_at: updatedLead.closed_at ?? null,
      },
    });

    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
      [
        context.organizationId,
        leadId,
        context.userId,
        `Status changed from ${oldStatus} to ${newStatus}`,
        JSON.stringify({
          oldStatus,
          newStatus,
          reasonCode,
          reasonNotes,
        }),
      ],
    );

    return updatedLead;
  });
}

export async function listLeadStageHistory(
  context: TenantContext,
  leadId: string,
): Promise<LeadStageHistory[]> {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (tx) => {
    const leadRes = await tx.query(
      "SELECT * FROM leads WHERE organization_id = $1 AND id = $2",
      [context.organizationId, leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error("Lead not found");
    }
    assertPermission(context, "read", "lead", lead);

    const history = await tx.query<LeadStageHistory>(
      `SELECT *
       FROM lead_stage_history
       WHERE organization_id = $1 AND lead_id = $2
       ORDER BY created_at DESC`,
      [context.organizationId, leadId],
    );
    return history.rows;
  });
}

/**
 * Reassigns a lead to a new agent. Requires 'update_all' permission (Manager/Admin/Owner).
 */
export async function assignLead(
  context: TenantContext,
  leadId: string,
  targetUserId: string,
) {
  assertPermission(context, "update_all", "lead");

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query("SELECT * FROM leads WHERE id = $1", [
      leadId,
    ]);
    if (existing.rows.length === 0) {
      throw new Error("Lead not found");
    }
    const lead = existing.rows[0];
    const previousAssignee = lead.assigned_user_id;

    // Assert active tenant membership
    const targetMember = await assertActiveTenantMember(
      context,
      targetUserId,
      undefined,
      tx,
    );
    const targetUserName = targetMember.fullName || "Agent";

    const res = await tx.query(
      `UPDATE leads
       SET assigned_user_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [targetUserId, leadId],
    );
    const updated = res.rows[0];

    // 1. Audit Log
    await recordAuditLog(tx, context, {
      action: "UPDATE",
      entityType: "lead",
      entityId: leadId,
      beforeState: { assigned_user_id: previousAssignee },
      afterState: { assigned_user_id: targetUserId },
    });

    // 2. Timeline Activity
    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        leadId,
        context.userId,
        `Lead reassigned to ${targetUserName}`,
        JSON.stringify({ previousAssignee, targetUserId }),
      ],
    );

    return updated;
  });
}

export interface UpdateLeadInput {
  fullName?: string;
  phone?: string;
  email?: string | null;
  customData?: Record<string, unknown>;
}

/**
 * Updates lead details with dynamic custom field validation and audit logging.
 */
export async function updateLead(
  context: TenantContext,
  leadId: string,
  input: UpdateLeadInput,
) {
  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query("SELECT * FROM leads WHERE id = $1", [
      leadId,
    ]);
    if (existing.rows.length === 0) {
      throw new Error("Lead not found");
    }
    const currentLead = existing.rows[0];
    assertPermission(context, "update", "lead", currentLead);

    let updatedCustomData = currentLead.custom_data;
    if (input.customData) {
      const defsRes = await tx.query(
        `SELECT * FROM custom_field_definitions
         WHERE organization_id = $1 AND entity_type = 'lead' AND is_active = true`,
        [context.organizationId],
      );
      const mergedCustomData = {
        ...currentLead.custom_data,
        ...input.customData,
      };
      updatedCustomData =
        defsRes.rows.length > 0
          ? validateCustomData(defsRes.rows, mergedCustomData)
          : mergedCustomData;
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [leadId];
    let paramIdx = 2;

    if (input.fullName !== undefined) {
      updates.push(`full_name = $${paramIdx++}`);
      params.push(input.fullName.trim());
    }
    if (input.phone !== undefined) {
      updates.push(`phone = $${paramIdx++}`);
      params.push(input.phone.trim());
    }
    if (input.email !== undefined) {
      updates.push(`email = $${paramIdx++}`);
      params.push(input.email?.trim() || null);
    }
    if (input.customData !== undefined) {
      updates.push(`custom_data = $${paramIdx++}`);
      params.push(JSON.stringify(updatedCustomData));
    }

    const res = await tx.query(
      `UPDATE leads
       SET ${updates.join(", ")}
       WHERE id = $1
       RETURNING *`,
      params,
    );

    const updated = res.rows[0];

    await recordAuditLog(tx, context, {
      action: "UPDATE",
      entityType: "lead",
      entityId: leadId,
      beforeState: currentLead,
      afterState: updated,
    });

    return updated;
  });
}

/**
 * Deletes a lead. Strictly requires 'delete' permission (Admin/Owner only).
 */
export async function deleteLead(context: TenantContext, leadId: string) {
  assertPermission(context, "delete", "lead");

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query("SELECT * FROM leads WHERE id = $1", [
      leadId,
    ]);
    if (existing.rows.length === 0) {
      throw new Error("Lead not found");
    }
    const lead = existing.rows[0];

    await tx.query("DELETE FROM leads WHERE id = $1", [leadId]);

    await recordAuditLog(tx, context, {
      action: "DELETE",
      entityType: "lead",
      entityId: leadId,
      beforeState: lead,
    });

    return { success: true };
  });
}
