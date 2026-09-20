import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  assertPermission,
  assertCanAccessIndividualLeadRecords,
} from "../permissions/checker.js";
import { getLead } from "./lead-service.js";

export type ActivityType =
  "CALL" | "WHATSAPP" | "EMAIL" | "MEETING" | "NOTE" | "STATUS_CHANGE";

export interface LogActivityInput {
  leadId: string;
  activityType: ActivityType;
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Logs an interaction on the lead's chronological timeline.
 */
export async function logActivity(
  context: TenantContext,
  input: LogActivityInput,
) {
  assertPermission(context, "update", "lead");

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Update lead's last_contacted_at timestamp
    await tx.query(
      "UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [input.leadId],
    );

    // 2. Insert the activity record
    const res = await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, lead_id, user_id, activity_type, summary, details, created_at`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        input.activityType,
        input.summary.trim(),
        JSON.stringify(input.details || {}),
      ],
    );

    return res.rows[0];
  });
}

/**
 * Retrieves the complete chronological activity timeline for a lead.
 * Asserts individual lead access permission (rejects MARKETING_USER) and
 * verifies row-level lead assignment for SALESPERSON.
 */
export async function listLeadActivities(
  context: TenantContext,
  leadId: string,
) {
  assertCanAccessIndividualLeadRecords(context);
  // Asserts lead exists, belongs to tenant, and is assigned to caller if SALESPERSON
  if (context.role === "SALESPERSON") {
    await getLead(context, leadId);
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT a.id, a.lead_id, a.user_id, u.full_name as author_name,
              a.activity_type, a.summary, a.details, a.created_at
       FROM activities a
       JOIN users u ON u.id = a.user_id
       WHERE a.lead_id = $1
       ORDER BY a.created_at DESC`,
      [leadId],
    );

    return res.rows;
  });
}
