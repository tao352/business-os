import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import { enqueueOutboxEvent } from "../rules/outbox-service.js";
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

/**
 * Sends an outbound WhatsApp message (Template or Free-form text) using durable outbox delivery semantics.
 * Follows explicit lifecycle: PENDING -> SENDING -> SENT | FAILED | UNKNOWN.
 * Provider call occurs strictly outside database transactions.
 */
export async function sendWhatsAppMessage(
  context: TenantContext,
  input: SendWhatsAppTemplateInput | SendWhatsAppTextInput,
  client?: WhatsAppApiClient,
  executionOptions?: { messageId?: string; idempotencyKey?: string },
): Promise<WhatsAppMessageRecord> {
  const apiClient = client || new DefaultWhatsAppApiClient();

  // 1. Fetch Integration credentials with decrypted token
  const integration = await getDecryptedWhatsAppIntegration(
    context,
    input.phoneNumberId,
  );

  const messageId = executionOptions?.messageId || crypto.randomUUID();
  const idempotencyKey =
    executionOptions?.idempotencyKey ||
    crypto
      .createHash("sha256")
      .update(`${context.organizationId}:wa:${messageId}`)
      .digest("hex");

  let messageType: "template" | "text";
  let bodyText: string;

  if ("templateName" in input) {
    messageType = "template";
    bodyText = `Template: ${input.templateName}`;
  } else {
    messageType = "text";
    bodyText = input.text;
  }

  // 2. Atomically persist PENDING message record and outbox event before provider dispatch
  await withTenantContext(context.organizationId, async (tx) => {
    await tx.query(
      `INSERT INTO whatsapp_messages (
        id, organization_id, wamid, lead_id, direction, sender_phone,
        recipient_phone, message_type, body, status
      ) VALUES ($1, $2, NULL, $3, 'OUTBOUND', $4, $5, $6, $7, 'PENDING')
      ON CONFLICT (id) DO NOTHING`,
      [
        messageId,
        context.organizationId,
        input.leadId || null,
        integration.display_phone_number || input.phoneNumberId,
        input.recipientPhone,
        messageType,
        bodyText,
      ],
    );

    await enqueueOutboxEvent(
      tx,
      context,
      "whatsapp.send_outbound",
      {
        messageId,
        phoneNumberId: input.phoneNumberId,
        recipientPhone: input.recipientPhone,
        messageType,
        bodyText,
        templateName: "templateName" in input ? input.templateName : undefined,
        languageCode: "languageCode" in input ? input.languageCode : undefined,
        variables: "variables" in input ? input.variables : undefined,
        leadId: input.leadId,
      },
      idempotencyKey,
    );
  });

  // 3. Transition message status to SENDING
  await withTenantContext(context.organizationId, async (tx) => {
    await tx.query(
      `UPDATE whatsapp_messages SET status = 'SENDING' WHERE id = $1 AND organization_id = $2`,
      [messageId, context.organizationId],
    );
  });

  // 4. Provider Dispatch (NETWORK CALL STRICTLY OUTSIDE DATABASE TRANSACTION)
  let wamid: string;
  try {
    if ("templateName" in input) {
      const res = await apiClient.sendTemplate(
        input.phoneNumberId,
        integration.access_token,
        input.recipientPhone,
        input.templateName,
        input.languageCode || "en",
        input.variables,
      );
      wamid = res.wamid;
    } else {
      const res = await apiClient.sendText(
        input.phoneNumberId,
        integration.access_token,
        input.recipientPhone,
        input.text,
      );
      wamid = res.wamid;
    }
  } catch (err: any) {
    // 5. Ambiguous failure recovery:
    // If a network timeout or reset occurred during SENDING, transition to UNKNOWN
    // rather than blind immediate resend to prevent customer message duplication.
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

    throw err;
  }

  // 6. On Meta confirmation, store WAMID and transition status to SENT
  return await withTenantContext(context.organizationId, async (tx) => {
    const msgRes = await tx.query(
      `UPDATE whatsapp_messages
       SET status = 'SENT', wamid = $1
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [wamid, messageId, context.organizationId],
    );

    const msg = msgRes.rows[0];

    // 7. Record Activity on Lead Timeline if leadId present
    if (input.leadId) {
      await tx.query(
        `INSERT INTO activities (
          organization_id, lead_id, user_id, activity_type, summary, details
        ) VALUES ($1, $2, $3, 'WHATSAPP', $4, $5)`,
        [
          context.organizationId,
          input.leadId,
          context.userId,
          `Outbound WhatsApp ${messageType}: ${bodyText.slice(0, 60)}`,
          JSON.stringify({
            wamid,
            recipient: input.recipientPhone,
            messageType,
            body: bodyText,
          }),
        ],
      );
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
    };
  });
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
