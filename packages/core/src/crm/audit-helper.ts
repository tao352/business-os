import type {
  TenantContext,
  AuditActionType,
  AuditActorType,
} from "@business-os/types";

export interface TransactionClient {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface RecordAuditLogInput {
  action: AuditActionType;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  actorType?: AuditActorType;
}

/**
 * Inserts an immutable audit log record within the current transaction client.
 */
export async function recordAuditLog(
  client: TransactionClient,
  context: TenantContext,
  input: RecordAuditLogInput,
) {
  await client.query(
    `INSERT INTO audit_logs (
      organization_id, actor_id, actor_type, action,
      entity_type, entity_id, before_state, after_state
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      context.organizationId,
      context.userId,
      input.actorType || "USER",
      input.action,
      input.entityType,
      input.entityId,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
    ],
  );
}
