import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Reservation,
  type ReservationStatus,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";

export class UnitNotAvailableError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly currentStatus: string,
  ) {
    super(
      `Unit '${unitId}' cannot be reserved because it is currently '${currentStatus}' (must be 'AVAILABLE')`,
    );
    this.name = "UnitNotAvailableError";
  }
}

export interface CreateReservationInput {
  leadId: string;
  unitId: string;
  depositAmount: number;
  currency?: string;
  expiresAt: string; // ISO datetime
  paymentMethod?: string;
  notes?: string;
}

export interface ListReservationsFilters {
  leadId?: string;
  unitId?: string;
  status?: ReservationStatus;
}

export async function createReservation(
  context: TenantContext,
  input: CreateReservationInput,
): Promise<Reservation> {
  assertPermission(context, "create", "reservation");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Concurrency Lock: Lock the unit row for update to prevent race conditions
    const unitRes = await client.query<{
      id: string;
      unit_number: string;
      status: string;
    }>(`SELECT id, unit_number, status FROM units WHERE id = $1 FOR UPDATE`, [
      input.unitId,
    ]);
    const unit = unitRes.rows[0];
    if (!unit) {
      throw new Error(`Unit '${input.unitId}' not found`);
    }

    if (unit.status !== "AVAILABLE") {
      throw new UnitNotAvailableError(unit.id, unit.status);
    }

    // 2. Lock unit status to RESERVED
    await client.query(
      `UPDATE units SET status = 'RESERVED', updated_at = NOW() WHERE id = $1`,
      [input.unitId],
    );

    // 3. Create Reservation record
    const insertSql = `
      INSERT INTO reservations (
        organization_id,
        lead_id,
        unit_id,
        reserved_by_user_id,
        deposit_amount,
        currency,
        status,
        expires_at,
        payment_method,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', $7, $8, $9)
      RETURNING *
    `;

    const currency = input.currency ?? "EGP";
    const res = await client.query<Reservation>(insertSql, [
      context.organizationId,
      input.leadId,
      input.unitId,
      context.userId,
      input.depositAmount,
      currency,
      input.expiresAt,
      input.paymentMethod ?? null,
      input.notes ?? null,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create reservation");
    }

    // 4. Progress Lead status to RESERVED
    await client.query(
      `UPDATE leads SET status = 'RESERVED', updated_at = NOW() WHERE id = $1`,
      [input.leadId],
    );

    // 5. Append Activity to Lead Timeline
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Unit #${unit.unit_number} reserved with deposit of ${input.depositAmount} ${currency}`,
        JSON.stringify({
          reservationId: created.id,
          unitId: input.unitId,
          deposit: input.depositAmount,
        }),
      ],
    );

    // 6. Audit Log
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "reservation",
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        reservationId: created.id,
        unitId: input.unitId,
      },
      "Successfully placed unit reservation",
    );

    return created;
  });
}

export async function cancelReservation(
  context: TenantContext,
  reservationId: string,
  reason?: string,
): Promise<Reservation> {
  assertPermission(context, "update", "reservation");

  return await withTenantContext(context.organizationId, async (client) => {
    const resRes = await client.query<Reservation>(
      `SELECT * FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    const existing = resRes.rows[0];
    if (!existing) {
      throw new Error(`Reservation '${reservationId}' not found`);
    }

    if (existing.status === "CANCELLED" || existing.status === "CONVERTED") {
      throw new Error(
        `Cannot cancel reservation with status '${existing.status}'`,
      );
    }

    // 1. Mark reservation as CANCELLED
    const updateRes = await client.query<Reservation>(
      `UPDATE reservations
       SET status = 'CANCELLED', notes = COALESCE($1, notes), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason ? `Cancelled: ${reason}` : null, reservationId],
    );
    const updated = updateRes.rows[0]!;

    // 2. Restore Unit status to AVAILABLE
    await client.query(
      `UPDATE units SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1`,
      [existing.unit_id],
    );

    // 3. Log Timeline Activity
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        existing.lead_id,
        context.userId,
        `Reservation cancelled. Unit returned to available inventory.`,
        JSON.stringify({ reservationId, reason }),
      ],
    );

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "reservation",
      entityId: reservationId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}

export async function listReservations(
  context: TenantContext,
  filters: ListReservationsFilters = {},
): Promise<Reservation[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.leadId) {
      whereClauses.push(`lead_id = $${idx++}`);
      params.push(filters.leadId);
    }
    if (filters.unitId) {
      whereClauses.push(`unit_id = $${idx++}`);
      params.push(filters.unitId);
    }
    if (filters.status) {
      whereClauses.push(`status = $${idx++}`);
      params.push(filters.status);
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const querySql = `
      SELECT * FROM reservations
      ${whereSql}
      ORDER BY created_at DESC
    `;

    const res = await client.query<Reservation>(querySql, params);
    return res.rows;
  });
}
