import { withTenantContext } from '@business-os/database';
import type { TenantContext } from '@business-os/types';
import { assertPermission } from '../permissions/checker.js';
import { recordAuditLog } from './audit-helper.js';

export type DealStage =
  | 'DISCOVERY'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';

export interface CreateDealInput {
  leadId: string;
  title: string;
  value: number;
  currency?: string;
  stage?: DealStage;
  expectedCloseDate?: string | null;
  assignedUserId?: string | null;
  customData?: Record<string, unknown>;
}

/**
 * Creates a commercial opportunity / deal attached to a lead.
 */
export async function createDeal(context: TenantContext, input: CreateDealInput) {
  assertPermission(context, 'create', 'contract');

  return await withTenantContext(context.organizationId, async (tx) => {
    const stage: DealStage = input.stage || 'DISCOVERY';

    const res = await tx.query(
      `INSERT INTO deals (
        organization_id, lead_id, title, value, currency,
        stage, expected_close_date, assigned_user_id, custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        context.organizationId,
        input.leadId,
        input.title.trim(),
        input.value,
        input.currency || 'USD',
        stage,
        input.expectedCloseDate || null,
        input.assignedUserId || context.userId,
        JSON.stringify(input.customData || {}),
      ]
    );

    const deal = res.rows[0];

    await recordAuditLog(tx, context, {
      action: 'CREATE',
      entityType: 'deal',
      entityId: deal.id,
      afterState: deal,
    });

    // Log timeline activity on the associated lead
    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Deal created: ${deal.title} (${deal.value} ${deal.currency})`,
        JSON.stringify({ dealId: deal.id, value: deal.value, stage }),
      ]
    );

    return deal;
  });
}

/**
 * Updates a deal's stage in the sales pipeline.
 */
export async function updateDealStage(
  context: TenantContext,
  dealId: string,
  newStage: DealStage
) {
  assertPermission(context, 'update', 'contract');

  return await withTenantContext(context.organizationId, async (tx) => {
    const existing = await tx.query('SELECT * FROM deals WHERE id = $1', [dealId]);
    if (existing.rows.length === 0) {
      throw new Error('Deal not found');
    }
    const deal = existing.rows[0];
    const oldStage = deal.stage;

    if (oldStage === newStage) {
      return deal;
    }

    const res = await tx.query(
      `UPDATE deals
       SET stage = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newStage, dealId]
    );
    const updatedDeal = res.rows[0];

    await recordAuditLog(tx, context, {
      action: 'UPDATE',
      entityType: 'deal',
      entityId: dealId,
      beforeState: { stage: oldStage },
      afterState: { stage: newStage },
    });

    // Log to lead activity timeline
    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
      [
        context.organizationId,
        deal.lead_id,
        context.userId,
        `Deal "${deal.title}" stage changed from ${oldStage} to ${newStage}`,
        JSON.stringify({ dealId, oldStage, newStage }),
      ]
    );

    return updatedDeal;
  });
}

/**
 * Lists deals with optional stage or assignee filters.
 */
export async function listDeals(context: TenantContext, filters: { stage?: DealStage } = {}) {
  assertPermission(context, 'read', 'contract');

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.stage) {
      conditions.push(`stage = $${paramIdx++}`);
      params.push(filters.stage);
    }

    const query = `
      SELECT d.*, l.full_name as lead_name, u.full_name as assignee_name
      FROM deals d
      JOIN leads l ON l.id = d.lead_id
      LEFT JOIN users u ON u.id = d.assigned_user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
    `;

    const res = await tx.query(query, params);
    return res.rows;
  });
}
