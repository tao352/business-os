import crypto from "node:crypto";
import type { TenantContext, WhatsAppMessageRecord } from "@business-os/types";
import type { TransactionClient } from "../crm/audit-helper.js";

export interface EnqueueWhatsAppInput {
  phoneNumberId: string;
  recipientPhone: string;
  messageType: "template" | "text";
  text?: string;
  templateName?: string;
  languageCode?: string;
  variables?: string[];
  leadId?: string | null;
  messageId?: string;
}

/**
 * Core transactional helper that persists a PENDING message and enqueues an outbox event.
 * Shared by direct WhatsApp send, Smart Rules engine, and future AI dispatchers.
 * Enforces concurrent API idempotency via ON CONFLICT DO NOTHING without aborting transactions.
 */
export async function enqueueWhatsAppOutbound(
  tx: TransactionClient,
  context: TenantContext,
  input: EnqueueWhatsAppInput,
  idempotencyKey?: string,
): Promise<WhatsAppMessageRecord & { outboxId?: string }> {
  // 1. Fast path: if idempotencyKey is supplied, check if already exists
  if (idempotencyKey) {
    const existingKeyRes = await tx.query(
      `SELECT id, organization_id, wamid, lead_id, direction, sender_phone,
              recipient_phone, message_type, body, status, created_at
       FROM whatsapp_messages
       WHERE organization_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [context.organizationId, idempotencyKey],
    );
    if (existingKeyRes.rows.length > 0) {
      const msg = existingKeyRes.rows[0];
      const existingOutbox = await tx.query(
        `SELECT id FROM outbox_events WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [context.organizationId, idempotencyKey],
      );
      return {
        id: msg.id,
        organizationId: msg.organization_id,
        wamid: msg.wamid,
        leadId: msg.lead_id,
        direction: msg.direction,
        senderPhone: msg.sender_phone,
        recipientPhone: msg.recipient_phone,
        messageType: msg.message_type,
        body: msg.body,
        status: msg.status,
        createdAt: msg.created_at,
        outboxId: existingOutbox.rows[0]?.id,
      };
    }
  }

  // 2. If explicit messageId is supplied, check if already exists
  if (input.messageId) {
    const existingIdRes = await tx.query(
      `SELECT id, organization_id, wamid, lead_id, direction, sender_phone,
              recipient_phone, message_type, body, status, created_at
       FROM whatsapp_messages
       WHERE organization_id = $1 AND id = $2
       LIMIT 1`,
      [context.organizationId, input.messageId],
    );
    if (existingIdRes.rows.length > 0) {
      const msg = existingIdRes.rows[0];
      const existingOutbox = await tx.query(
        `SELECT id FROM outbox_events WHERE organization_id = $1 AND payload->>'messageId' = $2 LIMIT 1`,
        [context.organizationId, input.messageId],
      );
      return {
        id: msg.id,
        organizationId: msg.organization_id,
        wamid: msg.wamid,
        leadId: msg.lead_id,
        direction: msg.direction,
        senderPhone: msg.sender_phone,
        recipientPhone: msg.recipient_phone,
        messageType: msg.message_type,
        body: msg.body,
        status: msg.status,
        createdAt: msg.created_at,
        outboxId: existingOutbox.rows[0]?.id,
      };
    }
  }

  const messageId = input.messageId || crypto.randomUUID();
  const actualIdempotencyKey =
    idempotencyKey ||
    crypto
      .createHash("sha256")
      .update(`${context.organizationId}:wa:${messageId}`)
      .digest("hex");

  const bodyText =
    input.messageType === "template"
      ? `Template: ${input.templateName || "default"}`
      : input.text || "";

  // 3. Concurrency-safe INSERT: ON CONFLICT DO NOTHING ensures PostgreSQL
  // will never abort the transaction even under concurrent identical requests.
  const msgRes = await tx.query(
    `INSERT INTO whatsapp_messages (
      id, organization_id, idempotency_key, wamid, lead_id, direction, sender_phone,
      recipient_phone, message_type, body, status
    ) VALUES ($1, $2, $3, NULL, $4, 'OUTBOUND', $5, $6, $7, $8, 'PENDING')
    ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING *`,
    [
      messageId,
      context.organizationId,
      actualIdempotencyKey,
      input.leadId || null,
      input.phoneNumberId,
      input.recipientPhone,
      input.messageType,
      bodyText,
    ],
  );

  let msg: any;
  if (msgRes.rows.length === 0) {
    // Concurrent request already inserted this idempotency key.
    // Query the existing message safely since transaction was NOT aborted.
    const conflictRes = await tx.query(
      `SELECT id, organization_id, wamid, lead_id, direction, sender_phone,
              recipient_phone, message_type, body, status, created_at
       FROM whatsapp_messages
       WHERE organization_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [context.organizationId, actualIdempotencyKey],
    );
    msg = conflictRes.rows[0];
  } else {
    msg = msgRes.rows[0];
  }

  // 4. Concurrency-safe outbox event enqueue
  const outboxPayload = {
    messageId: msg.id,
    phoneNumberId: input.phoneNumberId,
    recipientPhone: input.recipientPhone,
    messageType: input.messageType,
    text: input.text,
    bodyText,
    templateName: input.templateName,
    languageCode: input.languageCode,
    variables: input.variables,
    leadId: input.leadId,
  };

  const outboxRes = await tx.query(
    `INSERT INTO outbox_events (
      organization_id, event_type, payload, idempotency_key, status
    ) VALUES ($1, 'whatsapp.send_outbound', $2, $3, 'PENDING')
    ON CONFLICT (organization_id, idempotency_key)
    DO NOTHING
    RETURNING id`,
    [
      context.organizationId,
      JSON.stringify(outboxPayload),
      actualIdempotencyKey,
    ],
  );

  let outboxId: string;
  if (outboxRes.rows.length === 0) {
    const existingOutbox = await tx.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [context.organizationId, actualIdempotencyKey],
    );
    outboxId = existingOutbox.rows[0]?.id;
  } else {
    outboxId = outboxRes.rows[0].id;
  }

  return {
    id: msg.id,
    organizationId: msg.organization_id,
    wamid: msg.wamid,
    leadId: msg.lead_id,
    direction: msg.direction,
    senderPhone: msg.sender_phone,
    recipientPhone: msg.recipient_phone,
    messageType: msg.message_type,
    body: msg.body,
    status: msg.status,
    createdAt: msg.created_at,
    outboxId,
  };
}
