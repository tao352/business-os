import { withTenantContext } from '@business-os/database';
import type { TenantContext, LeadStatus } from '@business-os/types';
import { assertPermission, can } from '../permissions/checker.js';
import { recordAuditLog } from './audit-helper.js';
import { validateCustomData } from '../metadata/custom-fields-compiler.js';

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

/**
 * Creates a new lead with custom field validation, audit logging and an initial activity note.
 */
export async function createLead(context: TenantContext, input: CreateLeadInput) {
  assertPermission(context, 'create', 'lead');

  return await withTenantContext(context.organizationId, async (tx) => {
    const status: LeadStatus = input.status || 'NEW';
    const source = input.source || 'MANUAL';

    // 1. Fetch active custom field definitions and validate payload
    const defsRes = await tx.query(
      `SELECT * FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = 'lead' AND is_active = true`,
      [context.organizationId]
    );

    const validatedCustomData = defsRes.rows.length > 0
      ? validateCustomData(defsRes.rows, input.customData || {})
      : (input.customData || {});

    const res = await tx.query(
      `INSERT INTO leads (
        organization_id, full_name, phone, email, status,
        assigned_user_id, campaign_id, source, custom_data
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
      ]
    );

    const lead = res.rows[0];

    // 1. Immutable Audit Log
    await recordAuditLog(tx, context, {
      action: 'CREATE',
      entityType: 'lead',
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
      ]
    );

    return lead;
  });
}

/**
 * Retrieves a single lead, asserting row-level ownership if user is a SALESPERSON.
 */
export async function getLead(context: TenantContext, leadId: string) {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (res.rows.length === 0) {
      throw new Error('Lead not found');
    }

    const lead = res.rows[0];
    assertPermission(context, 'read', 'lead', lead);

    return lead;
  });
}

/**
 * Lists leads with filtering, pagination, and role-based assignment constraints.
 */
export async function listLeads(context: TenantContext, filters: ListLeadsFilters = {}) {
  assertPermission(context, 'read', 'lead');

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Enforce SALESPERSON assignment constraint
    if (context.role === 'SALESPERSON') {
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
        `(full_name ILIKE $${paramIdx} OR phone ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`
      );
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const query = `
      SELECT * FROM leads
      WHERE ${conditions.join(' AND ')}
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
  newStatus: LeadStatus
) {
  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (existing.rows.length === 0) {
      throw new Error('Lead not found');
    }

    const lead = existing.rows[0];
    assertPermission(context, 'update', 'lead', lead);

    const oldStatus = lead.status;
    if (oldStatus === newStatus) {
      return lead;
    }

    const res = await tx.query(
      `UPDATE leads
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newStatus, leadId]
    );
    const updatedLead = res.rows[0];

    // 1. Audit Log
    await recordAuditLog(tx, context, {
      action: 'UPDATE',
      entityType: 'lead',
      entityId: leadId,
      beforeState: { status: oldStatus },
      afterState: { status: newStatus },
    });

    // 2. Timeline Activity
    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
      [
        context.organizationId,
        leadId,
        context.userId,
        `Status changed from ${oldStatus} to ${newStatus}`,
        JSON.stringify({ oldStatus, newStatus }),
      ]
    );

    return updatedLead;
  });
}

/**
 * Reassigns a lead to a new agent. Requires 'update_all' permission (Manager/Admin/Owner).
 */
export async function assignLead(
  context: TenantContext,
  leadId: string,
  targetUserId: string
) {
  assertPermission(context, 'update_all', 'lead');

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (existing.rows.length === 0) {
      throw new Error('Lead not found');
    }
    const lead = existing.rows[0];
    const previousAssignee = lead.assigned_user_id;

    // Fetch target user name for timeline activity
    const targetUserRes = await tx.query('SELECT full_name FROM users WHERE id = $1', [targetUserId]);
    const targetUserName = targetUserRes.rows[0]?.full_name || 'Agent';

    const res = await tx.query(
      `UPDATE leads
       SET assigned_user_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [targetUserId, leadId]
    );
    const updated = res.rows[0];

    // 1. Audit Log
    await recordAuditLog(tx, context, {
      action: 'UPDATE',
      entityType: 'lead',
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
      ]
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
  input: UpdateLeadInput
) {
  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (existing.rows.length === 0) {
      throw new Error('Lead not found');
    }
    const currentLead = existing.rows[0];
    assertPermission(context, 'update', 'lead', currentLead);

    let updatedCustomData = currentLead.custom_data;
    if (input.customData) {
      const defsRes = await tx.query(
        `SELECT * FROM custom_field_definitions
         WHERE organization_id = $1 AND entity_type = 'lead' AND is_active = true`,
        [context.organizationId]
      );
      const mergedCustomData = { ...currentLead.custom_data, ...input.customData };
      updatedCustomData = defsRes.rows.length > 0
        ? validateCustomData(defsRes.rows, mergedCustomData)
        : mergedCustomData;
    }

    const updatedFullName = input.fullName !== undefined ? input.fullName.trim() : currentLead.full_name;
    const updatedPhone = input.phone !== undefined ? input.phone.trim() : currentLead.phone;
    const updatedEmail = input.email !== undefined ? input.email?.trim() || null : currentLead.email;

    const res = await tx.query(
      `UPDATE leads
       SET full_name = $1, phone = $2, email = $3, custom_data = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [updatedFullName, updatedPhone, updatedEmail, JSON.stringify(updatedCustomData), leadId]
    );

    const updated = res.rows[0];

    await recordAuditLog(tx, context, {
      action: 'UPDATE',
      entityType: 'lead',
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
  assertPermission(context, 'delete', 'lead');

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (existing.rows.length === 0) {
      throw new Error('Lead not found');
    }
    const lead = existing.rows[0];

    await tx.query('DELETE FROM leads WHERE id = $1', [leadId]);

    await recordAuditLog(tx, context, {
      action: 'DELETE',
      entityType: 'lead',
      entityId: leadId,
      beforeState: lead,
    });

    return { success: true };
  });
}
