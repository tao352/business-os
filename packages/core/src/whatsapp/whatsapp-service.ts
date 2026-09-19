import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import {
  enqueueOutboxEvent,
  processPendingOutboxEvents,
  TerminalOutboxError,
} from "../rules/outbox-service.js";
import type {
  TenantContext,
  SendWhatsAppTemplateInput,
  SendWhatsAppTextInput,
  WhatsAppMessageRecord,
  WhatsAppWebhookPayload,
} from "@business-os/types";
import { recordAuditLog } from "../crm/audit-helper.js";
import { triggerRules } from "../rules/rule-runner.js";
import {
  WhatsAppApiClient,
  DefaultWhatsAppApiClient,
} from "./whatsapp-client.js";
import { findWhatsAppIntegrationByPhoneNumberId } from "./whatsapp-integration-service.js";
import { getDecryptedWhatsAppIntegration } from "../integrations/credential-service.js";

export interface ProcessWebhookResult {
  messagesProcessed: number;
  statusesUpdated: number;
  leadsCreated: number;
  leadsUpdated: number;
}

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
 * Enforces real API idempotency via (organization_id, idempotency_key).
 */
export async function enqueueWhatsAppOutbound(
  tx: TransactionClient,
  context: TenantContext,
  input: EnqueueWhatsAppInput,
  idempotencyKey?: string,
): Promise<WhatsAppMessageRecord & { outboxId?: string }> {
  // 1. Idempotent check: if idempotencyKey is supplied, return existing message if already enqueued
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

  // 3. Atomically persist PENDING message with idempotency_key
  let msgRes;
  try {
    msgRes = await tx.query(
      `INSERT INTO whatsapp_messages (
        id, organization_id, idempotency_key, wamid, lead_id, direction, sender_phone,
        recipient_phone, message_type, body, status
      ) VALUES ($1, $2, $3, NULL, $4, 'OUTBOUND', $5, $6, $7, $8, 'PENDING')
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
  } catch (err: any) {
    if (err.code === "23505") {
      const conflictRes = await tx.query(
        `SELECT id, organization_id, wamid, lead_id, direction, sender_phone,
                recipient_phone, message_type, body, status, created_at
         FROM whatsapp_messages
         WHERE organization_id = $1 AND (idempotency_key = $2 OR id = $3)
         LIMIT 1`,
        [context.organizationId, actualIdempotencyKey, messageId],
      );
      if (conflictRes.rows.length > 0) {
        const msg = conflictRes.rows[0];
        const existingOutbox = await tx.query(
          `SELECT id FROM outbox_events WHERE organization_id = $1 AND (idempotency_key = $2 OR payload->>'messageId' = $3) LIMIT 1`,
          [context.organizationId, actualIdempotencyKey, messageId],
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
    throw err;
  }

  // 4. Enqueue into transactional outbox
  const outboxId = await enqueueOutboxEvent(
    tx,
    context,
    "whatsapp.send_outbound",
    {
      messageId,
      phoneNumberId: input.phoneNumberId,
      recipientPhone: input.recipientPhone,
      messageType: input.messageType,
      bodyText,
      templateName: input.templateName,
      languageCode: input.languageCode,
      variables: input.variables,
      leadId: input.leadId,
    },
    actualIdempotencyKey,
  );

  const msg = msgRes.rows[0];
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

/**
 * Enqueues an outbound WhatsApp message (Template or Free-form text) into the transactional outbox.
 * Strictly ENQUEUE-ONLY: writes PENDING message and outbox event in a single database transaction.
 * Zero external HTTP provider calls occur within this function.
 */
export async function sendWhatsAppMessage(
  context: TenantContext,
  input: SendWhatsAppTemplateInput | SendWhatsAppTextInput,
  _client?: WhatsAppApiClient,
  executionOptions?: { messageId?: string; idempotencyKey?: string },
): Promise<WhatsAppMessageRecord> {
  // 1. Fetch Integration credentials to ensure integration exists
  const integration = await getDecryptedWhatsAppIntegration(
    context,
    input.phoneNumberId,
  );

  const messageType = "templateName" in input ? "template" : "text";

  // 2. Atomically persist PENDING message record and outbox event in ONE database transaction
  return await withTenantContext(context.organizationId, async (tx) => {
    return await enqueueWhatsAppOutbound(
      tx,
      context,
      {
        phoneNumberId: integration.phone_number_id,
        recipientPhone: input.recipientPhone,
        messageType,
        text: "text" in input ? input.text : undefined,
        templateName: "templateName" in input ? input.templateName : undefined,
        languageCode: "languageCode" in input ? input.languageCode : undefined,
        variables: "variables" in input ? input.variables : undefined,
        leadId: input.leadId,
        messageId: executionOptions?.messageId,
      },
      executionOptions?.idempotencyKey,
    );
  });
}

/**
 * Outbox processor handler for 'whatsapp.send_outbound' events.
 * Executes external Meta Graph API dispatch strictly outside DB transactions.
 * Guarantees durable delivery lifecycle and suppresses blind retries on ambiguous failures.
 */
export async function handleWhatsAppOutboundEvent(
  context: TenantContext,
  payload: Record<string, unknown>,
  client?: WhatsAppApiClient,
): Promise<{ wamid: string; status: "SENT" } | { status: "SKIPPED" }> {
  const apiClient = client || new DefaultWhatsAppApiClient();
  const messageId = String(payload.messageId);
  const phoneNumberId = String(payload.phoneNumberId);
  const recipientPhone = String(payload.recipientPhone);
  const messageType = String(payload.messageType);
  const bodyText = String(payload.bodyText || "");
  const leadId = payload.leadId ? String(payload.leadId) : null;

  // 1. Inspect current message state in database
  const currentMsg = await withTenantContext(
    context.organizationId,
    async (tx) => {
      const res = await tx.query(
        `SELECT id, status, wamid FROM whatsapp_messages WHERE id = $1 AND organization_id = $2`,
        [messageId, context.organizationId],
      );
      return res.rows[0];
    },
  );

  if (!currentMsg) {
    throw new TerminalOutboxError(`Message with id ${messageId} not found`);
  }

  // Idempotency: if already confirmed SENT, DELIVERED, or READ, skip
  if (["SENT", "DELIVERED", "READ"].includes(currentMsg.status)) {
    return { wamid: currentMsg.wamid, status: "SENT" };
  }

  // Ambiguous suppression: if message was already marked UNKNOWN, reject blind retry
  if (currentMsg.status === "UNKNOWN") {
    throw new TerminalOutboxError(
      `Message ${messageId} is in UNKNOWN status; blind retry suppressed pending webhook reconciliation.`,
    );
  }

  // Recovery ambiguity check: if message was already marked SENDING, an earlier worker crashed mid-flight.
  // Transition to UNKNOWN and throw TerminalOutboxError to prevent duplicate dispatch.
  if (currentMsg.status === "SENDING") {
    await withTenantContext(context.organizationId, async (tx) => {
      await tx.query(
        `UPDATE whatsapp_messages SET status = 'UNKNOWN' WHERE id = $1 AND organization_id = $2`,
        [messageId, context.organizationId],
      );
    });
    throw new TerminalOutboxError(
      `Message ${messageId} was already in SENDING status from prior worker attempt; transitioning to UNKNOWN to prevent customer duplicate dispatch.`,
    );
  }

  // 2. Fetch decrypted integration credentials
  const integration = await getDecryptedWhatsAppIntegration(
    context,
    phoneNumberId,
  );

  // 3. Transition message status to SENDING
  await withTenantContext(context.organizationId, async (tx) => {
    await tx.query(
      `UPDATE whatsapp_messages SET status = 'SENDING' WHERE id = $1 AND organization_id = $2`,
      [messageId, context.organizationId],
    );
  });

  // 4. Provider Dispatch (OUTSIDE DATABASE TRANSACTION)
  let wamid: string;
  try {
    if (messageType === "template") {
      const templateName = String(payload.templateName);
      const languageCode = String(payload.languageCode || "en");
      const variables = Array.isArray(payload.variables)
        ? (payload.variables as string[])
        : undefined;
      const res = await apiClient.sendTemplate(
        phoneNumberId,
        integration.access_token,
        recipientPhone,
        templateName,
        languageCode,
        variables,
      );
      wamid = res.wamid;
    } else {
      const res = await apiClient.sendText(
        phoneNumberId,
        integration.access_token,
        recipientPhone,
        bodyText,
      );
      wamid = res.wamid;
    }
  } catch (err: any) {
    const isAmbiguousNetworkError =
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      err.message?.includes("timeout") ||
      err.message?.includes("fetch failed") ||
      err.message?.includes("network");

    const failureStatus = isAmbiguousNetworkError ? "UNKNOWN" : "FAILED";

    await withTenantContext(context.organizationId, async (tx) => {
      await tx.query(
        `UPDATE whatsapp_messages SET status = $1 WHERE id = $2 AND organization_id = $3`,
        [failureStatus, messageId, context.organizationId],
      );
    });

    if (isAmbiguousNetworkError) {
      throw new TerminalOutboxError(
        `Ambiguous network error during dispatch: ${err.message}. Transitioned message ${messageId} to UNKNOWN; blind retry suppressed.`,
      );
    }

    throw new TerminalOutboxError(
      `Definitive provider failure: ${err.message}`,
    );
  }

  // 5. On provider confirmation, mark message SENT with wamid and log activity
  await withTenantContext(context.organizationId, async (tx) => {
    await tx.query(
      `UPDATE whatsapp_messages
       SET status = 'SENT', wamid = $1
       WHERE id = $2 AND organization_id = $3`,
      [wamid, messageId, context.organizationId],
    );

    if (leadId) {
      await tx.query(
        `INSERT INTO activities (
          organization_id, lead_id, user_id, activity_type, summary, details
        ) VALUES ($1, $2, $3, 'WHATSAPP', $4, $5)`,
        [
          context.organizationId,
          leadId,
          context.userId,
          `Outbound WhatsApp ${messageType}: ${bodyText.slice(0, 60)}`,
          JSON.stringify({
            wamid,
            phoneNumberId,
            recipientPhone,
            messageType,
          }),
        ],
      );
    }
  });

  return { wamid, status: "SENT" };
}

/**
 * Convenience helper to process pending WhatsApp outbound messages for a tenant.
 */
export async function processPendingWhatsAppOutbox(
  context: TenantContext,
  client?: WhatsAppApiClient,
  limit = 20,
): Promise<{ processed: number; failed: number }> {
  return await processPendingOutboxEvents(
    context,
    {
      "whatsapp.send_outbound": async (payload) => {
        await handleWhatsAppOutboundEvent(context, payload, client);
      },
    },
    limit,
  );
}

/**
 * Processes incoming webhook payloads from Meta WhatsApp Cloud API (inbound messages & status updates).
 */
export async function processWhatsAppWebhookPayload(
  payload: WhatsAppWebhookPayload,
  _options: { apiClient?: WhatsAppApiClient } = {},
): Promise<ProcessWebhookResult> {
  const result: ProcessWebhookResult = {
    messagesProcessed: 0,
    statusesUpdated: 0,
    leadsCreated: 0,
    leadsUpdated: 0,
  };

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const lookup =
        await findWhatsAppIntegrationByPhoneNumberId(phoneNumberId);
      if (!lookup) continue;

      const systemContext: TenantContext = {
        userId: lookup.ownerUserId,
        organizationId: lookup.organizationId,
        role: "OWNER",
        correlationId: `wa-webhook-${phoneNumberId}-${Date.now()}`,
      };

      // 1. Process Status Updates
      for (const statusUpdate of value.statuses || []) {
        const wamid = statusUpdate.id;
        const normalizedStatus = statusUpdate.status.toUpperCase();

        await withTenantContext(systemContext.organizationId, async (tx) => {
          const res = await tx.query(
            `UPDATE whatsapp_messages SET status = $1
             WHERE organization_id = $2 AND wamid = $3`,
            [normalizedStatus, systemContext.organizationId, wamid],
          );
          if ((res.rowCount ?? 0) > 0) {
            result.statusesUpdated++;
          }
        });
      }

      // 2. Process Inbound Messages
      for (const msg of value.messages || []) {
        const wamid = msg.id;
        const senderPhone = msg.from;
        const bodyText = msg.text?.body || `[Media: ${msg.type}]`;

        let newlyCreatedLead: Record<string, unknown> | null = null;

        await withTenantContext(systemContext.organizationId, async (tx) => {
          // Idempotency check on wamid
          const existingMsg = await tx.query(
            `SELECT id FROM whatsapp_messages WHERE organization_id = $1 AND wamid = $2`,
            [systemContext.organizationId, wamid],
          );
          if (existingMsg.rows.length > 0) return;

          // Check if lead exists by phone
          const leadRes = await tx.query(
            `SELECT id, full_name, phone FROM leads
             WHERE organization_id = $1 AND phone = $2 LIMIT 1`,
            [systemContext.organizationId, senderPhone],
          );

          let targetLeadId: string;

          if (leadRes.rows.length > 0) {
            targetLeadId = leadRes.rows[0].id;
            await tx.query(
              `UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [targetLeadId],
            );
            result.leadsUpdated++;
          } else {
            // Create new lead from WhatsApp inbound message
            const newLeadRes = await tx.query(
              `INSERT INTO leads (
                organization_id, full_name, phone, status, source, custom_data
              ) VALUES ($1, $2, $3, 'NEW', 'WHATSAPP', $4)
              RETURNING *`,
              [
                systemContext.organizationId,
                `WhatsApp Contact (${senderPhone})`,
                senderPhone,
                JSON.stringify({ initial_channel: "whatsapp" }),
              ],
            );
            const newLead = newLeadRes.rows[0];
            targetLeadId = newLead.id;
            result.leadsCreated++;
            newlyCreatedLead = newLead;

            await recordAuditLog(tx, systemContext, {
              action: "CREATE",
              entityType: "lead",
              entityId: targetLeadId,
              afterState: newLead,
            });
          }

          // Record Message
          await tx.query(
            `INSERT INTO whatsapp_messages (
              organization_id, wamid, lead_id, direction, sender_phone,
              recipient_phone, message_type, body, status, raw_payload
            ) VALUES ($1, $2, $3, 'INBOUND', $4, $5, 'text', $6, 'DELIVERED', $7)`,
            [
              systemContext.organizationId,
              wamid,
              targetLeadId,
              senderPhone,
              phoneNumberId,
              bodyText,
              JSON.stringify(msg),
            ],
          );

          // Append Timeline Activity
          await tx.query(
            `INSERT INTO activities (
              organization_id, lead_id, user_id, activity_type, summary, details
            ) VALUES ($1, $2, $3, 'WHATSAPP', $4, $5)`,
            [
              systemContext.organizationId,
              targetLeadId,
              systemContext.userId,
              `Inbound WhatsApp message: ${bodyText.slice(0, 50)}`,
              JSON.stringify({ wamid, from: senderPhone, body: bodyText }),
            ],
          );

          result.messagesProcessed++;
        });

        // Trigger Smart Rules AFTER transaction commits (avoids nested transaction deadlock)
        if (newlyCreatedLead) {
          await triggerRules(
            systemContext,
            "lead.created",
            "lead",
            newlyCreatedLead,
          );
        }
      }
    }
  }

  return result;
}
