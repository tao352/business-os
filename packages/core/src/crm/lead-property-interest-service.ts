import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type LeadPropertyInterest,
  type LeadPropertyInterestStatus,
  type UnitUsageType,
  type UnitType,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "./audit-helper.js";

export interface CreateLeadInterestInput {
  leadId: string;
  projectId?: string | null;
  specificUnitId?: string | null;
  usageType?: UnitUsageType | null;
  unitType?: UnitType | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  preferredFloors?: string[] | null;
  isPrimary?: boolean;
  status?: LeadPropertyInterestStatus;
  notes?: string | null;
}

export interface UpdateLeadInterestInput {
  projectId?: string | null;
  specificUnitId?: string | null;
  usageType?: UnitUsageType | null;
  unitType?: UnitType | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  preferredFloors?: string[] | null;
  isPrimary?: boolean;
  status?: LeadPropertyInterestStatus;
  notes?: string | null;
}

export async function addLeadInterest(
  context: TenantContext,
  input: CreateLeadInterestInput,
): Promise<LeadPropertyInterest> {
  assertPermission(context, "create", "lead");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Verify lead exists and belongs to this organization
    const leadRes = await client.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM leads WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, input.leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${input.leadId}' not found`);
    }

    const isPrimary = input.isPrimary ?? true;
    const status = input.status ?? "ACTIVE";

    // 2. If new interest is primary and active, demote existing primary active interests
    if (isPrimary && status === "ACTIVE") {
      await client.query(
        `UPDATE lead_property_interests
         SET is_primary = FALSE, updated_at = NOW()
         WHERE organization_id = $1 AND lead_id = $2 AND status = 'ACTIVE' AND is_primary = TRUE`,
        [context.organizationId, input.leadId],
      );
    }

    // 3. Insert new interest record
    const insertSql = `
      INSERT INTO lead_property_interests (
        organization_id,
        lead_id,
        project_id,
        specific_unit_id,
        usage_type,
        unit_type,
        budget_min,
        budget_max,
        area_min,
        area_max,
        preferred_floors,
        is_primary,
        status,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const res = await client.query<LeadPropertyInterest>(insertSql, [
      context.organizationId,
      input.leadId,
      input.projectId ?? null,
      input.specificUnitId ?? null,
      input.usageType ?? null,
      input.unitType ?? null,
      input.budgetMin !== undefined && input.budgetMin !== null
        ? Number(input.budgetMin)
        : null,
      input.budgetMax !== undefined && input.budgetMax !== null
        ? Number(input.budgetMax)
        : null,
      input.areaMin !== undefined && input.areaMin !== null
        ? Number(input.areaMin)
        : null,
      input.areaMax !== undefined && input.areaMax !== null
        ? Number(input.areaMax)
        : null,
      input.preferredFloors ?? null,
      isPrimary,
      status,
      input.notes?.trim() ?? null,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create lead property interest");
    }

    // 4. Append note to lead activity timeline
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Recorded property interest${isPrimary ? " (Primary)" : ""}: ${created.usage_type || created.unit_type || "General interest"}`,
        JSON.stringify({ interestId: created.id }),
      ],
    );

    // 5. Audit Log
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "lead",
      entityId: input.leadId,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        leadId: input.leadId,
        interestId: created.id,
      },
      "Successfully created lead property interest",
    );

    return created;
  });
}

export async function listLeadInterests(
  context: TenantContext,
  leadId: string,
  statusFilter?: LeadPropertyInterestStatus,
): Promise<LeadPropertyInterest[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const params: unknown[] = [context.organizationId, leadId];
    let statusSql = "";
    if (statusFilter) {
      params.push(statusFilter);
      statusSql = "AND status = $3";
    }

    const res = await client.query<LeadPropertyInterest>(
      `SELECT * FROM lead_property_interests
       WHERE organization_id = $1 AND lead_id = $2 ${statusSql}
       ORDER BY is_primary DESC, created_at DESC`,
      params,
    );

    return res.rows;
  });
}

export async function getLeadInterest(
  context: TenantContext,
  interestId: string,
): Promise<LeadPropertyInterest | null> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<LeadPropertyInterest>(
      `SELECT * FROM lead_property_interests
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, interestId],
    );

    return res.rows[0] ?? null;
  });
}

export async function updateLeadInterest(
  context: TenantContext,
  interestId: string,
  input: UpdateLeadInterestInput,
): Promise<LeadPropertyInterest> {
  assertPermission(context, "update", "lead");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<LeadPropertyInterest>(
      `SELECT * FROM lead_property_interests
       WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, interestId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Lead property interest '${interestId}' not found`);
    }

    const nextStatus = input.status ?? existing.status;
    const nextIsPrimary = input.isPrimary ?? existing.is_primary;

    // Demote existing primary active interests if this one becomes primary and active
    if (
      nextIsPrimary &&
      nextStatus === "ACTIVE" &&
      (!existing.is_primary || existing.status !== "ACTIVE")
    ) {
      await client.query(
        `UPDATE lead_property_interests
         SET is_primary = FALSE, updated_at = NOW()
         WHERE organization_id = $1 AND lead_id = $2 AND id != $3 AND status = 'ACTIVE' AND is_primary = TRUE`,
        [context.organizationId, existing.lead_id, interestId],
      );
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [context.organizationId, interestId];
    let idx = 3;

    if (input.projectId !== undefined) {
      updates.push(`project_id = $${idx++}`);
      params.push(input.projectId);
    }
    if (input.specificUnitId !== undefined) {
      updates.push(`specific_unit_id = $${idx++}`);
      params.push(input.specificUnitId);
    }
    if (input.usageType !== undefined) {
      updates.push(`usage_type = $${idx++}`);
      params.push(input.usageType);
    }
    if (input.unitType !== undefined) {
      updates.push(`unit_type = $${idx++}`);
      params.push(input.unitType);
    }
    if (input.budgetMin !== undefined) {
      updates.push(`budget_min = $${idx++}`);
      params.push(input.budgetMin !== null ? Number(input.budgetMin) : null);
    }
    if (input.budgetMax !== undefined) {
      updates.push(`budget_max = $${idx++}`);
      params.push(input.budgetMax !== null ? Number(input.budgetMax) : null);
    }
    if (input.areaMin !== undefined) {
      updates.push(`area_min = $${idx++}`);
      params.push(input.areaMin !== null ? Number(input.areaMin) : null);
    }
    if (input.areaMax !== undefined) {
      updates.push(`area_max = $${idx++}`);
      params.push(input.areaMax !== null ? Number(input.areaMax) : null);
    }
    if (input.preferredFloors !== undefined) {
      updates.push(`preferred_floors = $${idx++}`);
      params.push(input.preferredFloors);
    }
    if (input.isPrimary !== undefined) {
      updates.push(`is_primary = $${idx++}`);
      params.push(input.isPrimary);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${idx++}`);
      params.push(input.status);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      params.push(input.notes?.trim() ?? null);
    }

    const updateSql = `
      UPDATE lead_property_interests
      SET ${updates.join(", ")}
      WHERE organization_id = $1 AND id = $2
      RETURNING *
    `;

    const res = await client.query<LeadPropertyInterest>(updateSql, params);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update lead property interest");
    }

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "lead",
      entityId: existing.lead_id,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
