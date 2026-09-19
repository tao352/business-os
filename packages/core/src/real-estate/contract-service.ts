import { withTenantContext } from '@business-os/database';
import { logger } from '@business-os/logger';
import {
  type TenantContext,
  type Contract,
  type ContractStatus,
  type Installment,
} from '@business-os/types';
import { assertPermission } from '../permissions/checker.js';
import { recordAuditLog } from '../crm/audit-helper.js';

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
  input: CreateContractInput
): Promise<Contract> {
  assertPermission(context, 'create', 'contract');

  return await withTenantContext(context.organizationId, async (client) => {
    // 1. Fetch unit details
    const unitRes = await client.query<{ id: string; unit_number: string }>(
      `SELECT id, unit_number FROM units WHERE id = $1`,
      [input.unitId]
    );
    const unit = unitRes.rows[0];
    if (!unit) {
      throw new Error(`Unit '${input.unitId}' not found`);
    }

    // 2. If converting from reservation, mark reservation as CONVERTED
    if (input.reservationId) {
      await client.query(
        `UPDATE reservations SET status = 'CONVERTED', updated_at = NOW() WHERE id = $1`,
        [input.reservationId]
      );
    }

    const status = input.status ?? 'DRAFT';
    const isExecuted = status === 'SIGNED' || status === 'ACTIVE';

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
      input.currency ?? 'EGP',
      JSON.stringify(input.paymentSchedule ?? []),
      input.signedAt ?? null,
      status,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error('Failed to create contract');
    }

    // 4. If executed, transition unit & lead status to CONTRACTED
    if (isExecuted) {
      await client.query(
        `UPDATE units SET status = 'CONTRACTED', updated_at = NOW() WHERE id = $1`,
        [input.unitId]
      );
      await client.query(
        `UPDATE leads SET status = 'CONTRACTED', updated_at = NOW() WHERE id = $1`,
        [input.leadId]
      );

      // Append to lead timeline
      await client.query(
        `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
         VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
        [
          context.organizationId,
          input.leadId,
          context.userId,
          `Contract #${input.contractNumber} executed for Unit #${unit.unit_number} (Value: ${input.contractValue} ${input.currency ?? 'EGP'})`,
          JSON.stringify({ contractId: created.id, contractNumber: input.contractNumber }),
        ]
      );
    }

    // 5. Audit Log
    await recordAuditLog(client, context, {
      action: 'CREATE',
      entityType: 'contract',
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      { organizationId: context.organizationId, contractId: created.id, contractNumber: created.contract_number },
      'Successfully created contract'
    );

    return created;
  });
}

export async function signContract(
  context: TenantContext,
  contractId: string,
  signedAt: string
): Promise<Contract> {
  assertPermission(context, 'update', 'contract');

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Contract>(
      `SELECT * FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Contract '${contractId}' not found`);
    }

    // 1. Update contract to SIGNED
    const updateRes = await client.query<Contract>(
      `UPDATE contracts
       SET status = 'SIGNED', signed_at = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [signedAt, contractId]
    );
    const updated = updateRes.rows[0]!;

    // 2. Lock unit to CONTRACTED
    await client.query(
      `UPDATE units SET status = 'CONTRACTED', updated_at = NOW() WHERE id = $1`,
      [existing.unit_id]
    );

    // 3. Update lead to CONTRACTED
    await client.query(
      `UPDATE leads SET status = 'CONTRACTED', updated_at = NOW() WHERE id = $1`,
      [existing.lead_id]
    );

    // 4. Log activity on timeline
    await client.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        existing.lead_id,
        context.userId,
        `Contract #${existing.contract_number} signed officially!`,
        JSON.stringify({ contractId, signedAt }),
      ]
    );

    await recordAuditLog(client, context, {
      action: 'UPDATE',
      entityType: 'contract',
      entityId: contractId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}

export async function listContracts(
  context: TenantContext,
  filters: ListContractsFilters = {}
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

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const querySql = `
      SELECT * FROM contracts
      ${whereSql}
      ORDER BY created_at DESC
    `;

    const res = await client.query<Contract>(querySql, params);
    return res.rows;
  });
}
