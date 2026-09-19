import { withTenantContext } from '@business-os/database';
import { logger } from '@business-os/logger';
import {
  type TenantContext,
  type Unit,
  type UnitStatus,
} from '@business-os/types';
import { assertPermission } from '../permissions/checker.js';
import { recordAuditLog } from '../crm/audit-helper.js';
import { validateCustomData } from '../metadata/custom-fields-compiler.js';

export interface CreateUnitInput {
  projectId: string;
  unitNumber: string;
  unitType: string;
  grossArea: number;
  price: number;
  currency?: string;
  status?: UnitStatus;
  paymentPlanTemplate?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}

export interface ListUnitsFilters {
  projectId?: string;
  status?: UnitStatus;
  unitType?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}

export async function createUnit(
  context: TenantContext,
  input: CreateUnitInput
): Promise<Unit> {
  assertPermission(context, 'create', 'unit');

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Validate custom fields if any
    const defsRes = await client.query(
      `SELECT * FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = 'unit' AND is_active = true`,
      [context.organizationId]
    );

    const validatedCustomData = defsRes.rows.length > 0
      ? validateCustomData(defsRes.rows, input.customData ?? {})
      : (input.customData ?? {});

    // 2. Insert unit
    const insertSql = `
      INSERT INTO units (
        organization_id,
        project_id,
        unit_number,
        unit_type,
        gross_area,
        price,
        currency,
        status,
        payment_plan_template,
        custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const res = await client.query<Unit>(insertSql, [
      context.organizationId,
      input.projectId,
      input.unitNumber.trim(),
      input.unitType.trim(),
      input.grossArea,
      input.price,
      input.currency ?? 'EGP',
      input.status ?? 'AVAILABLE',
      JSON.stringify(input.paymentPlanTemplate ?? {}),
      JSON.stringify(validatedCustomData),
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error('Failed to create unit');
    }

    // 3. Increment project total_units count
    await client.query(
      `UPDATE projects SET total_units = total_units + 1, updated_at = NOW() WHERE id = $1`,
      [input.projectId]
    );

    // 4. Audit Log
    await recordAuditLog(client, context, {
      action: 'CREATE',
      entityType: 'unit',
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      { organizationId: context.organizationId, unitId: created.id, unitNumber: created.unit_number },
      'Successfully created unit'
    );

    return created;
  });
}

export async function getUnit(
  context: TenantContext,
  unitId: string
): Promise<Unit | null> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<Unit>(
      `SELECT * FROM units WHERE id = $1`,
      [unitId]
    );
    return res.rows[0] ?? null;
  });
}

export async function listUnits(
  context: TenantContext,
  filters: ListUnitsFilters = {}
): Promise<Unit[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.projectId) {
      whereClauses.push(`project_id = $${idx++}`);
      params.push(filters.projectId);
    }
    if (filters.status) {
      whereClauses.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.unitType) {
      whereClauses.push(`unit_type = $${idx++}`);
      params.push(filters.unitType);
    }
    if (filters.minPrice !== undefined) {
      whereClauses.push(`price >= $${idx++}`);
      params.push(filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      whereClauses.push(`price <= $${idx++}`);
      params.push(filters.maxPrice);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    params.push(limit, offset);
    const querySql = `
      SELECT * FROM units
      ${whereSql}
      ORDER BY unit_number ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const res = await client.query<Unit>(querySql, params);
    return res.rows;
  });
}

export async function updateUnitStatus(
  context: TenantContext,
  unitId: string,
  newStatus: UnitStatus
): Promise<Unit> {
  assertPermission(context, 'update', 'unit');

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Unit>(
      `SELECT * FROM units WHERE id = $1`,
      [unitId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Unit '${unitId}' not found`);
    }

    const updateSql = `
      UPDATE units
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const res = await client.query<Unit>(updateSql, [newStatus, unitId]);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error('Failed to update unit status');
    }

    await recordAuditLog(client, context, {
      action: 'UPDATE',
      entityType: 'unit',
      entityId: unitId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
