import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type { TenantContext } from "@business-os/types";
import type { TransactionClient } from "../crm/audit-helper.js";

export interface OutboxEvent {
  id: string;
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  processingStartedAt?: Date | null;
  workerId?: string | null;
  createdAt: Date;
  processedAt?: Date | null;
}

/**
 * Enqueues an external side effect into the outbox_events table within the caller's transaction.
 * Guarantees zero side effects occur if the database transaction rolls back.
 */
export async function enqueueOutboxEvent(
  tx: TransactionClient,
  context: TenantContext,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  maxRetries = 5,
): Promise<string> {
  const res = await tx.query(
    `INSERT INTO outbox_events (
      organization_id, event_type, payload, idempotency_key,
      status, max_retries, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'PENDING', $5, NOW(), NOW())
    ON CONFLICT (organization_id, idempotency_key) DO UPDATE SET
      updated_at = NOW()
    RETURNING id`,
    [
      context.organizationId,
      eventType,
      JSON.stringify(payload),
      idempotencyKey,
      maxRetries,
    ],
  );

  return res.rows[0]?.id as string;
}

/**
 * Processes pending outbox events for a tenant.
 * Executes external network side effects outside database transactions.
 * Atomically reclaims orphaned PROCESSING events whose lease expired (> 5 minutes).
 */
export async function processPendingOutboxEvents(
  context: TenantContext,
  handlers: Record<
    string,
    (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>
  >,
  limit = 20,
  workerId = `worker-${crypto.randomBytes(4).toString("hex")}`,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  // 1. Atomically claim pending or expired-lease events using a CTE with FOR UPDATE SKIP LOCKED
  const events = await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `WITH claimable AS (
        SELECT id FROM outbox_events
        WHERE organization_id = $1
          AND (
            status = 'PENDING'
            OR (status = 'FAILED' AND retry_count < max_retries)
            OR (status = 'PROCESSING' AND processing_started_at < NOW() - INTERVAL '5 minutes')
          )
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events o
      SET status = 'PROCESSING',
          processing_started_at = NOW(),
          worker_id = $3,
          retry_count = CASE WHEN o.status = 'PROCESSING' THEN o.retry_count + 1 ELSE o.retry_count END,
          updated_at = NOW()
      FROM claimable
      WHERE o.id = claimable.id
      RETURNING o.*`,
      [context.organizationId, limit, workerId],
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      organizationId: r.organization_id,
      eventType: r.event_type,
      payload: r.payload,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      retryCount: r.retry_count,
      maxRetries: r.max_retries,
      lastError: r.last_error,
      processingStartedAt: r.processing_started_at,
      workerId: r.worker_id,
      createdAt: r.created_at,
      processedAt: r.processed_at,
    })) as OutboxEvent[];
  });

  for (const event of events) {
    const handler = handlers[event.eventType];
    if (!handler) {
      logger.warn(
        { eventType: event.eventType, eventId: event.id },
        "No registered handler for outbox event type; marking FAILED to prevent stuck processing",
      );
      failed++;
      await withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          `UPDATE outbox_events
           SET status = 'FAILED', last_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [
            `No handler registered for event type: ${event.eventType}`,
            event.id,
          ],
        );
      });
      continue;
    }

    try {
      // Execute side effect (NETWORK CALL STRICTLY OUTSIDE DATABASE TRANSACTION)
      await handler(event.payload);

      // Mark COMPLETED
      await withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          `UPDATE outbox_events SET status = 'COMPLETED', processed_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [event.id],
        );
      });

      processed++;
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        {
          eventId: event.id,
          error: errorMsg,
          retryCount: event.retryCount + 1,
        },
        "Failed to process outbox event",
      );

      await withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          `UPDATE outbox_events
           SET status = 'FAILED', retry_count = retry_count + 1, last_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [errorMsg, event.id],
        );
      });
    }
  }

  return { processed, failed };
}
