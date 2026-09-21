import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Contract,
  type ContractStatus,
  type Installment,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import { transitionLeadStageInTransaction } from "../crm/lead-lifecycle.js";

export interface CreateContractInput {
  reservationId?: string;
  leadId: string;
  unitId: string;
  contractNumber: string;
  contractValue: number;
  currency?: string;
  paymentSchedule?: Installment[];
  signedAt?: string;
  status?: ContractStatus;
}

export interface ListContractsFilters {
  leadId?: string;
  unitId?: string;
  status?: ContractStatus;
}

export async function createContract(
  context: TenantContext,
  input: CreateContractInput,
): Promise<Contract> {
  assertPermission(context, "create", "contract");

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Lock Unit first. Reservation flows use the same Unit -> Reservation
    // lock order, preventing cross-service deadlocks on the same inventory.
    const unitRes = await client.query<{ id: string; unit_number: string }>(
      `SELECT id, unit_number
       FROM units
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [context.organizationId, input.unitId],
    );
    const unit = unitRes.rows[0];
    if (!unit) {
      throw new Error(`Unit '${input.unitId}' not found`);
    }

    const status = input.status ?? "DRAFT";
    const isExecuted = status === "SIGNED" || status === "ACTIVE";

    // 2. If linked to a Reservation, lock it second and verify it belongs
    // to exactly the same Lead + Unit. Draft contracts keep the reservation
    // active; only an executed contract converts it.
    if (input.reservationId) {
      const reservationRes = await client.query<{
        id: string;
        lead_id: string;
        unit_id: string;
      }>(
        `SELECT id, lead_id, unit_id
         FROM reservations
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE`,
        [context.organizationId, input.reservationId],
      );
      const reservation = reservationRes.rows[0];
      if (!reservation) {
        throw new Error(`Reservation '${input.reservationId}' not found`);
      }
      if (
        reservation.lead_id !== input.leadId ||
        reservation.unit_id !== input.unitId
      ) {
        throw new Error(
          "Reservation does not belong to the supplied Lead and Unit",
        );
      }

      if (isExecuted) {
        await client.query(
          `UPDATE reservations
           SET status = 'CONVERTED', updated_at = NOW()
           WHERE organization_id = $1 AND id = $2`,
          [context.organizationId, input.reservationId],
        );
      }
    }

    // 3. Insert Contract
    const insertSql = `
      INSERT INTO contracts (
        organization_id,
        reservation_id,
        lead_id,
        unit_id,
        contract_number,
        contract_value,
        currency,
        payment_schedule,
        signed_at,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const res = await client.query<Contract>(insertSql, [
      context.organizationId,
      input.reservationId ?? null,
      input.leadId,
      input.unitId,
      input.contractNumber.trim(),
      input.contractValue,
      input.currency ?? "EGP",
      JSON.stringify(input.paymentSchedule ?? []),
      input.signedAt ?? null,
      status,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create contract");
    }

    // 4. If executed, transition unit & lead status to CONTRACTED
    if (isExecuted) {
      await client.query(
        `UPDATE units SET status = 'CONTRACTED', updated_at = NOW() WHERE id = $1`,
        [input.unitId],
      );
      await transitionLeadStageInTransaction(
        client,
        context,
        input.leadId,
        "CONTRACTED",
        {
          enforceTransition: false,
          metadata: {
            source: "contract_executed",
            contractId: created.id,
            unitId: input.unitId,
          },
        },
      );

      // Append to lead timeline
      await client.query(
        `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
         VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
        [
          context.organizationId,
          input.leadId,
          context.userId,
          `Contract #${input.contractNumber} executed for Unit #${unit.unit_number} (Value: ${input.contractValue} ${input.currency ?? "EGP"})`,
          JSON.stringify({
            contractId: created.id,
            contractNumber: input.contractNumber,
          }),
        ],
      );
    }

    // 5. Audit Log
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "contract",
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        contractId: created.id,
        contractNumber: created.contract_number,
      },
      "Successfully created contract",
    );

    return created;
  });
}

export async function signContract(
  context: TenantContext,
  contractId: string,
  signedAt: string,
): Promise<Contract> {
  assertPermission(context, "update", "contract");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Contract>(
      `SELECT * FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Contract '${contractId}' not found`);
    }

    // 1. Lock the Unit before any Reservation row to preserve the same
    // Unit -> Reservation ordering used by reservation flows.
    const unitRes = await client.query(
      `SELECT id
       FROM units
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [context.organizationId, existing.unit_id],
    );
    if (unitRes.rows.length === 0) {
      throw new Error(`Unit '${existing.unit_id}' not found`);
    }

    // 2. A Draft contract keeps its Reservation active. Signing is the point
    // where that Reservation becomes CONVERTED.
    if (existing.reservation_id) {
      const reservationRes = await client.query<{
        id: string;
        lead_id: string;
        unit_id: string;
      }>(
        `SELECT id, lead_id, unit_id
         FROM reservations
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE`,
        [context.organizationId, existing.reservation_id],
      );
      const reservation = reservationRes.rows[0];
      if (!reservation) {
        throw new Error(`Reservation '${existing.reservation_id}' not found`);
      }
      if (
        reservation.lead_id !== existing.lead_id ||
        reservation.unit_id !== existing.unit_id
      ) {
        throw new Error(
          "Contract reservation does not match the Contract Lead and Unit",
        );
      }

      await client.query(
        `UPDATE reservations
         SET status = 'CONVERTED', updated_at = NOW()
         WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, existing.reservation_id],
      );
    }

    // 3. Update contract to SIGNED
    const updateRes = await client.query<Contract>(
      `UPDATE contracts
       SET status = 'SIGNED', signed_at = $1, updated_at = NOW()
       WHERE organization_id = $2 AND id = $3
       RETURNING *`,
      [signedAt, context.organizationId, contractId],
    );
    const updated = updateRes.rows[0]!;

    // 4. Contract the already-locked Unit.
    await client.query(
      `UPDATE units
       SET status = 'CONTRACTED', updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, existing.unit_id],
    );

    // 5. Progress the Lead through the same lifecycle engine used everywhere else.
    await transitionLeadStageInTransaction(
      client,
      context,
      existing.lead_id,
      "CONTRACTED",
      {
        enforceTransition: false,
        metadata: {
          source: "contract_signed",
          contractId,
          unitId: existing.unit_id,
        },
      },
    );

    // 6. Log activity on timeline
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        existing.lead_id,
        context.userId,
        `Contract #${existing.contract_number} signed officially!`,
        JSON.stringify({ contractId, signedAt }),
      ],
    );

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "contract",
      entityId: contractId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}

export async function listContracts(
  context: TenantContext,
  filters: ListContractsFilters = {},
): Promise<Contract[]> {
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
      SELECT * FROM contracts
      ${whereSql}
      ORDER BY created_at DESC
    `;

    const res = await client.query<Contract>(querySql, params);
    return res.rows;
  });
}
