import { withTenantContext } from '@business-os/database';
import { logger } from '@business-os/logger';
import {
  type TenantContext,
  type Visit,
  type VisitStatus,
} from '@business-os/types';
import { assertPermission } from '../permissions/checker.js';
import { recordAuditLog } from '../crm/audit-helper.js';

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
  input: ScheduleVisitInput
): Promise<Visit> {
  assertPermission(context, 'create', 'lead');

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Fetch Project name for friendly logging
    const projectRes = await client.query<{ name: string }>(
      `SELECT name FROM projects WHERE id = $1`,
      [input.projectId]
    );
    const projectName = projectRes.rows[0]?.name ?? 'Development Site';

    // 2. Insert into visits
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
      throw new Error('Failed to schedule visit');
    }

    // 3. Log Timeline Activity on the Lead
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'MEETING', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Site visit scheduled for project '${projectName}'`,
        JSON.stringify({ visitId: created.id, projectId: input.projectId, scheduledAt: input.scheduledAt }),
      ]
    );

    // 4. Progress Lead Status to SITE_VISIT_BOOKED if currently NEW, CONTACTED, or QUALIFIED
    await client.query(
      `UPDATE leads
       SET status = 'SITE_VISIT_BOOKED', updated_at = NOW()
       WHERE id = $1 AND status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'MEETING_SCHEDULED')`,
      [input.leadId]
    );

    // 5. Audit Log
    await recordAuditLog(client, context, {
      action: 'CREATE',
      entityType: 'visit',
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      { organizationId: context.organizationId, visitId: created.id, leadId: input.leadId },
      'Successfully scheduled site visit'
    );

    return created;
  });
}

export async function listVisits(
  context: TenantContext,
  filters: ListVisitsFilters = {}
): Promise<Visit[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.leadId) {
      whereClauses.push(`lead_id = $${idx++}`);
      params.push(filters.leadId);
    }
    if (filters.projectId) {
      whereClauses.push(`project_id = $${idx++}`);
      params.push(filters.projectId);
    }
    if (filters.status) {
      whereClauses.push(`status = $${idx++}`);
      params.push(filters.status);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const querySql = `
      SELECT * FROM visits
      ${whereSql}
      ORDER BY scheduled_at ASC
    `;

    const res = await client.query<Visit>(querySql, params);
    return res.rows;
  });
}

export async function updateVisitStatus(
  context: TenantContext,
  visitId: string,
  newStatus: VisitStatus,
  feedback?: string
): Promise<Visit> {
  assertPermission(context, 'update', 'lead');

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Visit>(
      `SELECT * FROM visits WHERE id = $1`,
      [visitId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Visit '${visitId}' not found`);
    }

    const updateSql = `
      UPDATE visits
      SET status = $1, feedback = COALESCE($2, feedback), updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    const res = await client.query<Visit>(updateSql, [newStatus, feedback ?? null, visitId]);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error('Failed to update visit status');
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
        JSON.stringify({ visitId, status: newStatus, feedback: feedback ?? null }),
      ]
    );

    await recordAuditLog(client, context, {
      action: 'UPDATE',
      entityType: 'visit',
      entityId: visitId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
