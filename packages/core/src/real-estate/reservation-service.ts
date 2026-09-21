import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Reservation,
  type ReservationStatus,
} from "@business-os/types";
import {
  assertPermission,
  assertCanAccessIndividualLeadRecords,
} from "../permissions/checker.js";
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

export interface ExpireStaleReservationsResult {
  expiredCount: number;
  expiredReservationIds: string[];
  restoredUnitIds: string[];
}

/**
 * Creates an exclusive unit reservation with dual-layer concurrency protection:
 * 1. Strict Lead ownership authorization (Salesperson can only reserve for assigned leads).
 * 2. Uniform Lock Ordering: Pessimistic row locking (SELECT FOR UPDATE) on the target Unit first,
 *    then the active Reservation second (preventing deadlocks).
 * 3. Protection A (Just-In-Time Expiration): Detects and atomically transitions
 *    any existing expired reservation on the unit to EXPIRED. Restores availability ONLY
 *    if unit status is RESERVED (never reopens CONTRACTED or BLOCKED units).
 * 4. PostgreSQL partial unique index (idx_active_unit_reservation) guaranteeing zero double-booking.
 */
export async function createReservation(
  context: TenantContext,
  input: CreateReservationInput,
): Promise<Reservation> {
  assertPermission(context, "create", "reservation");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Authorize lead access & ownership: salesperson cannot reserve for another agent's lead
    const leadRes = await client.query<{
      id: string;
      assigned_user_id: string | null;
      status: string;
    }>(
      `SELECT id, assigned_user_id, status FROM leads WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, input.leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${input.leadId}' not found`);
    }

    assertCanAccessIndividualLeadRecords(context, lead);
    assertPermission(context, "update", "lead", lead);

    // 2. Uniform Concurrency Lock: Lock the unit row FIRST (Unit -> Reservation lock order)
    const unitRes = await client.query<{
      id: string;
      unit_number: string;
      status: string;
    }>(
      `SELECT id, unit_number, status FROM units WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, input.unitId],
    );
    const unit = unitRes.rows[0];
    if (!unit) {
      throw new Error(`Unit '${input.unitId}' not found`);
    }

    // 3. Protection A: Just-In-Time Reservation Check
    // If unit is not AVAILABLE, inspect if an active reservation on it has expired
    if (unit.status !== "AVAILABLE") {
      // Lock reservation SECOND (maintains Unit -> Reservation order)
      const activeRes = await client.query<{
        id: string;
        lead_id: string;
        expires_at: Date;
        status: string;
      }>(
        `SELECT id, lead_id, expires_at, status FROM reservations
         WHERE organization_id = $1 AND unit_id = $2 AND status IN ('CONFIRMED', 'PENDING')
         FOR UPDATE`,
        [context.organizationId, input.unitId],
      );

      const staleReservation = activeRes.rows[0];
      if (
        staleReservation &&
        new Date(staleReservation.expires_at).getTime() < Date.now()
      ) {
        // Atomically expire the stale reservation
        await client.query(
          `UPDATE reservations SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
          [staleReservation.id],
        );

        // INVARIANT (Item 7): ONLY restore unit to AVAILABLE if unit is actually RESERVED.
        // Units marked CONTRACTED, BLOCKED, or SOLD must NEVER be reopened by stale reservations!
        if (unit.status === "RESERVED") {
          await client.query(
            `UPDATE units SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1 AND status = 'RESERVED'`,
            [input.unitId],
          );
          unit.status = "AVAILABLE";
        }

        // Audit log & timeline note
        await recordAuditLog(client, context, {
          action: "UPDATE",
          entityType: "reservation",
          entityId: staleReservation.id,
          beforeState: staleReservation,
          afterState: { ...staleReservation, status: "EXPIRED" },
        });

        await client.query(
          `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
           VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
          [
            context.organizationId,
            staleReservation.lead_id,
            context.userId,
            `Reservation expired for Unit #${unit.unit_number}.`,
            JSON.stringify({
              reservationId: staleReservation.id,
              unitId: input.unitId,
              restoredToAvailable: unit.status === "AVAILABLE",
            }),
          ],
        );

        logger.info(
          {
            organizationId: context.organizationId,
            reservationId: staleReservation.id,
            unitId: input.unitId,
            unitStatus: unit.status,
          },
          "Just-in-time check: expired stale reservation",
        );
      }
    }

    if (unit.status !== "AVAILABLE") {
      throw new UnitNotAvailableError(unit.id, unit.status);
    }

    // 4. Lock unit status to RESERVED
    await client.query(
      `UPDATE units SET status = 'RESERVED', updated_at = NOW() WHERE id = $1`,
      [input.unitId],
    );

    // 5. Create Reservation record protected by partial unique index
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
    try {
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

      // 6. Progress Lead status to RESERVED
      await client.query(
        `UPDATE leads SET status = 'RESERVED', updated_at = NOW() WHERE id = $1`,
        [input.leadId],
      );

      // 7. Append Activity to Lead Timeline
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

      // 8. Audit Log
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
    } catch (err: unknown) {
      // Catch unique violation from partial unique index (race condition protection)
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        throw new UnitNotAvailableError(input.unitId, "RESERVED");
      }
      throw err;
    }
  });
}

/**
 * Protection B: Periodic Scheduled Sweeper.
 * Finds expired active reservations (expires_at < NOW()), atomically transitions them
 * to EXPIRED, restores units to AVAILABLE (strictly when unit is RESERVED), and records audit logs.
 * Uniform Lock Order: Locks Units first, Reservations second, ordered by u.id ASC (preventing deadlocks).
 * Fully idempotent.
 */
export async function expireStaleReservations(
  context: TenantContext,
): Promise<ExpireStaleReservationsResult> {
  return await withTenantContext(context.organizationId, async (client) => {
    // Lock Units first, Reservations second, ordered by u.id ASC to enforce uniform lock order
    const staleRes = await client.query<{
      id: string;
      unit_id: string;
      lead_id: string;
      unit_number: string;
      reservation_status: string;
      unit_status: string;
    }>(
      `SELECT r.id, r.unit_id, r.lead_id, r.status as reservation_status,
              u.unit_number, u.status as unit_status
       FROM units u
       JOIN reservations r ON r.unit_id = u.id AND r.organization_id = u.organization_id
       WHERE u.organization_id = $1
         AND r.status IN ('CONFIRMED', 'PENDING')
         AND r.expires_at < NOW()
       ORDER BY u.id ASC
       FOR UPDATE OF u, r`,
      [context.organizationId],
    );

    const expiredIds: string[] = [];
    const restoredUnitIds: string[] = [];

    for (const r of staleRes.rows) {
      await client.query(
        `UPDATE reservations SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
        [r.id],
      );
      expiredIds.push(r.id);

      // INVARIANT (Item 7): ONLY restore unit status to AVAILABLE if unit is currently RESERVED.
      // If the unit has progressed to CONTRACTED or BLOCKED, do NOT touch unit status!
      if (r.unit_status === "RESERVED") {
        await client.query(
          `UPDATE units SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1 AND status = 'RESERVED'`,
          [r.unit_id],
        );
        restoredUnitIds.push(r.unit_id);
      }

      await recordAuditLog(client, context, {
        action: "UPDATE",
        entityType: "reservation",
        entityId: r.id,
        beforeState: { status: r.reservation_status },
        afterState: { status: "EXPIRED" },
      });

      await client.query(
        `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
         VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
        [
          context.organizationId,
          r.lead_id,
          context.userId || "00000000-0000-0000-0000-000000000000",
          `Reservation expired for Unit #${r.unit_number}.${r.unit_status === "RESERVED" ? " Unit restored to available inventory." : ""}`,
          JSON.stringify({
            reservationId: r.id,
            unitId: r.unit_id,
            restoredToAvailable: r.unit_status === "RESERVED",
          }),
        ],
      );
    }

    if (expiredIds.length > 0) {
      logger.info(
        {
          organizationId: context.organizationId,
          expiredCount: expiredIds.length,
          restoredUnits: restoredUnitIds.length,
        },
        "Scheduled sweeper: expired stale reservations and restored unit availability",
      );
    }

    return {
      expiredCount: expiredIds.length,
      expiredReservationIds: expiredIds,
      restoredUnitIds,
    };
  });
}

export async function cancelReservation(
  context: TenantContext,
  reservationId: string,
  reason?: string,
): Promise<Reservation> {
  assertPermission(context, "update", "reservation");

  return await withTenantContext(context.organizationId, async (client) => {
    const hintRes = await client.query<{ unit_id: string }>(
      `SELECT unit_id FROM reservations WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, reservationId],
    );
    const hint = hintRes.rows[0];
    if (!hint) {
      throw new Error(`Reservation '${reservationId}' not found`);
    }

    const unitRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM units WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, hint.unit_id],
    );
    const unit = unitRes.rows[0];
    if (!unit) {
      throw new Error(`Unit '${hint.unit_id}' not found`);
    }

    const resRes = await client.query<Reservation>(
      `SELECT * FROM reservations WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, reservationId],
    );
    const existing = resRes.rows[0];
    if (!existing) {
      throw new Error(`Reservation '${reservationId}' not found`);
    }
    if (existing.unit_id !== hint.unit_id) {
      throw new Error("Reservation unit changed while acquiring locks; retry");
    }

    const leadRes = await client.query<{
      id: string;
      assigned_user_id: string | null;
    }>(
      `SELECT id, assigned_user_id FROM leads WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, existing.lead_id],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${existing.lead_id}' not found`);
    }
    assertCanAccessIndividualLeadRecords(context, lead);
    assertPermission(context, "update", "lead", lead);

    if (["CANCELLED", "CONVERTED", "EXPIRED"].includes(existing.status)) {
      throw new Error(
        `Cannot cancel reservation with status '${existing.status}'`,
      );
    }

    const updateRes = await client.query<Reservation>(
      `UPDATE reservations SET status = 'CANCELLED', notes = COALESCE($1, notes), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [reason ? `Cancelled: ${reason}` : null, reservationId],
    );
    const updated = updateRes.rows[0];
    if (!updated) {
      throw new Error("Failed to cancel reservation");
    }

    const restoredToAvailable = unit.status === "RESERVED";
    if (restoredToAvailable) {
      await client.query(
        `UPDATE units SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1 AND status = 'RESERVED'`,
        [existing.unit_id],
      );
    }

    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        existing.lead_id,
        context.userId,
        restoredToAvailable
          ? "Reservation cancelled. Unit returned to available inventory."
          : "Reservation cancelled. Unit status was not reopened.",
        JSON.stringify({ reservationId, reason, restoredToAvailable }),
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
  assertPermission(context, "read", "reservation");

  return await withTenantContext(context.organizationId, async (client) => {
    if (filters.leadId) {
      const leadRes = await client.query<{
        id: string;
        assigned_user_id: string | null;
      }>(
        `SELECT id, assigned_user_id FROM leads WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, filters.leadId],
      );
      const lead = leadRes.rows[0];
      if (!lead) {
        return [];
      }
      assertCanAccessIndividualLeadRecords(context, lead);
      assertPermission(context, "read", "lead", lead);
    }

    const whereClauses: string[] = ["r.organization_id = $1"];
    const params: unknown[] = [context.organizationId];
    let idx = 2;

    if (context.role === "SALESPERSON") {
      whereClauses.push(`l.assigned_user_id = $${idx++}`);
      params.push(context.userId);
    }
    if (filters.leadId) {
      whereClauses.push(`r.lead_id = $${idx++}`);
      params.push(filters.leadId);
    }
    if (filters.unitId) {
      whereClauses.push(`r.unit_id = $${idx++}`);
      params.push(filters.unitId);
    }
    if (filters.status) {
      whereClauses.push(`r.status = $${idx++}`);
      params.push(filters.status);
    }

    const res = await client.query<Reservation>(
      `SELECT r.* FROM reservations r
       JOIN leads l ON l.id = r.lead_id AND l.organization_id = r.organization_id
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY r.created_at DESC`,
      params,
    );
    return res.rows;
  });
}
