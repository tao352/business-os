import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Unit,
  type UnitStatus,
  type UnitUsageType,
  type UnitType,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import { validateCustomData } from "../metadata/custom-fields-compiler.js";
import {
  inferUsageTypeFromUnitType,
  isUsageTypeCompatible,
} from "./unit-taxonomy.js";

export interface CreateUnitInput {
  projectId: string;
  unitNumber: string;
  usageType?: UnitUsageType;
  unitType?: UnitType;
  modelName?: string;
  floor?: string;
  grossArea: number;
  price: number;
  currency?: string;
  status?: UnitStatus;
  isActive?: boolean;
  paymentPlanTemplate?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}

export interface UpdateUnitInput {
  unitNumber?: string;
  usageType?: UnitUsageType;
  unitType?: UnitType;
  modelName?: string;
  floor?: string;
  grossArea?: number;
  price?: number;
  currency?: string;
  status?: UnitStatus;
  isActive?: boolean;
  paymentPlanTemplate?: Record<string, unknown>;
  customData?: Record<string, unknown>;
}

export interface ListUnitsFilters {
  projectId?: string;
  status?: UnitStatus;
  usageType?: UnitUsageType;
  unitType?: UnitType;
  floor?: string;
  isActive?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  limit?: number;
  offset?: number;
}

export async function createUnit(
  context: TenantContext,
  input: CreateUnitInput,
): Promise<Unit> {
  assertPermission(context, "create", "unit");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Validate custom fields if any
    const defsRes = await client.query(
      `SELECT * FROM custom_field_definitions
       WHERE organization_id = $1 AND entity_type = 'unit' AND is_active = true`,
      [context.organizationId],
    );

    const validatedCustomData =
      defsRes.rows.length > 0
        ? validateCustomData(defsRes.rows, input.customData ?? {})
        : (input.customData ?? {});

    // 2. Resolve and validate the authoritative unit classification.
    const unitType = input.unitType ?? "RETAIL_STORE";
    const inferredUsageType = inferUsageTypeFromUnitType(unitType);
    const usageType =
      input.usageType ?? inferredUsageType ?? ("COMMERCIAL" as UnitUsageType);

    if (!isUsageTypeCompatible(unitType, usageType)) {
      throw new Error(
        `Usage type '${usageType}' conflicts with unit type '${unitType}'`,
      );
    }

    // 3. Insert unit
    const insertSql = `
      INSERT INTO units (
        organization_id,
        project_id,
        unit_number,
        usage_type,
        unit_type,
        model_name,
        floor,
        gross_area,
        price,
        currency,
        status,
        is_active,
        payment_plan_template,
        custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const res = await client.query<Unit>(insertSql, [
      context.organizationId,
      input.projectId,
      input.unitNumber.trim(),
      usageType,
      unitType,
      input.modelName?.trim() ?? null,
      input.floor?.trim() ?? null,
      input.grossArea,
      input.price,
      input.currency ?? "EGP",
      input.status ?? "AVAILABLE",
      input.isActive ?? true,
      JSON.stringify(input.paymentPlanTemplate ?? {}),
      JSON.stringify(validatedCustomData),
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create unit");
    }

    // 4. Audit Log
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "unit",
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        unitId: created.id,
        unitNumber: created.unit_number,
      },
      "Successfully created unit",
    );

    return created;
  });
}

export async function getUnit(
  context: TenantContext,
  unitId: string,
): Promise<Unit | null> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<Unit>(`SELECT * FROM units WHERE id = $1`, [
      unitId,
    ]);
    return res.rows[0] ?? null;
  });
}

export async function listUnits(
  context: TenantContext,
  filters: ListUnitsFilters = {},
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
    if (filters.usageType) {
      whereClauses.push(`usage_type = $${idx++}`);
      params.push(filters.usageType);
    }
    if (filters.unitType) {
      whereClauses.push(`unit_type = $${idx++}`);
      params.push(filters.unitType);
    }
    if (filters.floor) {
      whereClauses.push(`floor = $${idx++}`);
      params.push(filters.floor);
    }
    if (filters.isActive !== undefined) {
      whereClauses.push(`is_active = $${idx++}`);
      params.push(filters.isActive);
    }
    if (filters.minPrice !== undefined) {
      whereClauses.push(`price >= $${idx++}`);
      params.push(filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      whereClauses.push(`price <= $${idx++}`);
      params.push(filters.maxPrice);
    }
    if (filters.minArea !== undefined) {
      whereClauses.push(`gross_area >= $${idx++}`);
      params.push(filters.minArea);
    }
    if (filters.maxArea !== undefined) {
      whereClauses.push(`gross_area <= $${idx++}`);
      params.push(filters.maxArea);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
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

export async function updateUnit(
  context: TenantContext,
  unitId: string,
  input: UpdateUnitInput,
): Promise<Unit> {
  assertPermission(context, "update", "unit");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Unit>(
      `SELECT * FROM units WHERE id = $1`,
      [unitId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Unit '${unitId}' not found`);
    }

    const nextUnitType = input.unitType ?? existing.unit_type;
    const inferredNextUsage = inferUsageTypeFromUnitType(nextUnitType);
    const nextUsageType =
      input.usageType ??
      (input.unitType !== undefined && inferredNextUsage
        ? inferredNextUsage
        : existing.usage_type);

    if (!isUsageTypeCompatible(nextUnitType, nextUsageType)) {
      throw new Error(
        `Usage type '${nextUsageType}' conflicts with unit type '${nextUnitType}'`,
      );
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [unitId];
    let idx = 2;

    if (input.unitNumber !== undefined) {
      updates.push(`unit_number = $${idx++}`);
      params.push(input.unitNumber.trim());
    }
    if (
      input.usageType !== undefined ||
      (input.unitType !== undefined && nextUsageType !== existing.usage_type)
    ) {
      updates.push(`usage_type = $${idx++}`);
      params.push(nextUsageType);
    }
    if (input.unitType !== undefined) {
      updates.push(`unit_type = $${idx++}`);
      params.push(nextUnitType);
    }
    if (input.modelName !== undefined) {
      updates.push(`model_name = $${idx++}`);
      params.push(input.modelName?.trim() ?? null);
    }
    if (input.floor !== undefined) {
      updates.push(`floor = $${idx++}`);
      params.push(input.floor?.trim() ?? null);
    }
    if (input.grossArea !== undefined) {
      updates.push(`gross_area = $${idx++}`);
      params.push(input.grossArea);
    }
    if (input.price !== undefined) {
      updates.push(`price = $${idx++}`);
      params.push(input.price);
    }
    if (input.currency !== undefined) {
      updates.push(`currency = $${idx++}`);
      params.push(input.currency);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${idx++}`);
      params.push(input.status);
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }
    if (input.paymentPlanTemplate !== undefined) {
      updates.push(`payment_plan_template = $${idx++}`);
      params.push(JSON.stringify(input.paymentPlanTemplate));
    }
    if (input.customData !== undefined) {
      const defsRes = await client.query(
        `SELECT * FROM custom_field_definitions
         WHERE organization_id = $1 AND entity_type = 'unit' AND is_active = true`,
        [context.organizationId],
      );
      const validated =
        defsRes.rows.length > 0
          ? validateCustomData(defsRes.rows, input.customData)
          : input.customData;
      updates.push(`custom_data = $${idx++}`);
      params.push(JSON.stringify(validated));
    }

    const updateSql = `
      UPDATE units
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING *
    `;

    const res = await client.query<Unit>(updateSql, params);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update unit");
    }

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "unit",
      entityId: unitId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}

export async function updateUnitStatus(
  context: TenantContext,
  unitId: string,
  newStatus: UnitStatus,
): Promise<Unit> {
  assertPermission(context, "update", "unit");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Unit>(
      `SELECT * FROM units WHERE id = $1`,
      [unitId],
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
      throw new Error("Failed to update unit status");
    }

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "unit",
      entityId: unitId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
