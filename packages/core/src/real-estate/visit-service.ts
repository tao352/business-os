import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Visit,
  type VisitStatus,
} from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";
import { assertActiveTenantMember } from "../permissions/tenant-member-guard.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import { transitionLeadStageInTransaction } from "../crm/lead-lifecycle.js";

export interface ScheduleVisitInput {
  leadId: string;
  projectId: string;
  scheduledAt: string; // ISO datetime
  assignedAgentId?: string;
  notes?: string;
}

export interface ListVisitsFilters {
  leadId?: string;
  projectId?: string;
  status?: VisitStatus;
}

export async function scheduleVisit(
  context: TenantContext,
  input: ScheduleVisitInput,
): Promise<Visit> {
  assertCanAccessIndividualLeadRecords(context);
  assertPermission(context, "update", "lead");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Authorize the exact Lead row before creating a Lead-specific visit.
    const leadRes = await client.query(
      `SELECT id, assigned_user_id
       FROM leads
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, input.leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${input.leadId}' not found`);
    }
    assertPermission(context, "update", "lead", lead);

    // Assigned agents must be active members of this tenant.
    if (input.assignedAgentId) {
      await assertActiveTenantMember(
        context,
        input.assignedAgentId,
        undefined,
        client,
      );
    }

    // 2. Fetch Project name for friendly logging.
    const projectRes = await client.query<{ name: string }>(
      `SELECT name
       FROM projects
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, input.projectId],
    );
    const project = projectRes.rows[0];
    if (!project) {
      throw new Error(`Project '${input.projectId}' not found`);
    }
    const projectName = project.name;

    // 3. Insert into visits
    const insertSql = `
      INSERT INTO visits (
        organization_id,
        lead_id,
        project_id,
        scheduled_by_user_id,
        assigned_agent_id,
        scheduled_at,
        status,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED', $7)
      RETURNING *
    `;

    const res = await client.query<Visit>(insertSql, [
      context.organizationId,
      input.leadId,
      input.projectId,
      context.userId,
      input.assignedAgentId ?? null,
      input.scheduledAt,
      input.notes ?? null,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to schedule visit");
    }

    // 4. Log Timeline Activity on the Lead
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'MEETING', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Site visit scheduled for project '${projectName}'`,
        JSON.stringify({
          visitId: created.id,
          projectId: input.projectId,
          scheduledAt: input.scheduledAt,
        }),
      ],
    );

    // 5. Progress Lead Status to SITE_VISIT_BOOKED only from the same
    // stages that the legacy conditional UPDATE allowed.
    await transitionLeadStageInTransaction(
      client,
      context,
      input.leadId,
      "SITE_VISIT_BOOKED",
      {
        onlyFrom: ["NEW", "CONTACTED", "QUALIFIED", "MEETING_SCHEDULED"],
        enforceTransition: false,
        metadata: {
          source: "visit_scheduled",
          visitId: created.id,
          projectId: input.projectId,
        },
      },
    );

    // 6. Audit Log
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "visit",
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        visitId: created.id,
        leadId: input.leadId,
      },
      "Successfully scheduled site visit",
    );

    return created;
  });
}

export async function listVisits(
  context: TenantContext,
  filters: ListVisitsFilters = {},
): Promise<Visit[]> {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (client) => {
    const whereClauses: string[] = ["v.organization_id = $1"];
    const params: unknown[] = [context.organizationId];
    let idx = 2;

    if (context.role === "SALESPERSON") {
      whereClauses.push(`l.assigned_user_id = $${idx++}`);
      params.push(context.userId);
    }
    if (filters.leadId) {
      whereClauses.push(`v.lead_id = $${idx++}`);
      params.push(filters.leadId);
    }
    if (filters.projectId) {
      whereClauses.push(`v.project_id = $${idx++}`);
      params.push(filters.projectId);
    }
    if (filters.status) {
      whereClauses.push(`v.status = $${idx++}`);
      params.push(filters.status);
    }

    const querySql = `
      SELECT v.*
      FROM visits v
      JOIN leads l
        ON l.organization_id = v.organization_id
       AND l.id = v.lead_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY v.scheduled_at ASC
    `;

    const res = await client.query<Visit>(querySql, params);
    return res.rows;
  });
}

export async function updateVisitStatus(
  context: TenantContext,
  visitId: string,
  newStatus: VisitStatus,
  feedback?: string,
): Promise<Visit> {
  assertCanAccessIndividualLeadRecords(context);
  assertPermission(context, "update", "lead");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Visit>(
      `SELECT *
       FROM visits
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, visitId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Visit '${visitId}' not found`);
    }

    const leadRes = await client.query(
      `SELECT id, assigned_user_id
       FROM leads
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, existing.lead_id],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${existing.lead_id}' not found`);
    }
    assertPermission(context, "update", "lead", lead);

    const updateSql = `
      UPDATE visits
      SET status = $1, feedback = COALESCE($2, feedback), updated_at = NOW()
      WHERE organization_id = $3 AND id = $4
      RETURNING *
    `;

    const res = await client.query<Visit>(updateSql, [
      newStatus,
      feedback ?? null,
      context.organizationId,
      visitId,
    ]);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update visit status");
    }

    // Append update to lead timeline
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'MEETING', $4, $5)`,
      [
        context.organizationId,
        existing.lead_id,
        context.userId,
        `Site visit marked as ${newStatus}`,
        JSON.stringify({
          visitId,
          status: newStatus,
          feedback: feedback ?? null,
        }),
      ],
    );

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "visit",
      entityId: visitId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
