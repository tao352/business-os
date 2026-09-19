import { withTenantContext } from "@business-os/database";
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
 * Sends an outbound WhatsApp message (Template or Free-form text) to a lead/contact.
 * Network dispatch occurs strictly outside database transactions to eliminate distributed failure loops.
 */
export async function sendWhatsAppMessage(
  context: TenantContext,
  input: SendWhatsAppTemplateInput | SendWhatsAppTextInput,
  client?: WhatsAppApiClient,
): Promise<WhatsAppMessageRecord> {
  const apiClient = client || new DefaultWhatsAppApiClient();

  // 1. Fetch Integration credentials with decrypted token (Read outside transaction)
  const integration = await getDecryptedWhatsAppIntegration(
    context,
    input.phoneNumberId,
  );

  // 2. Dispatch via API Client (NETWORK CALL STRICTLY OUTSIDE DATABASE TRANSACTION)
  let wamid: string;
  let messageType: "template" | "text";
  let bodyText: string;

  if ("templateName" in input) {
    messageType = "template";
    bodyText = `Template: ${input.templateName}`;
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
    messageType = "text";
    bodyText = input.text;
    const res = await apiClient.sendText(
      input.phoneNumberId,
      integration.access_token,
      input.recipientPhone,
      input.text,
    );
    wamid = res.wamid;
  }

  // 3. Persist sent message record and timeline activity in an atomic database transaction
  return await withTenantContext(context.organizationId, async (tx) => {
    const msgRes = await tx.query(
      `INSERT INTO whatsapp_messages (
        organization_id, wamid, lead_id, direction, sender_phone,
        recipient_phone, message_type, body, status
      ) VALUES ($1, $2, $3, 'OUTBOUND', $4, $5, $6, $7, 'SENT')
      RETURNING *`,
      [
        context.organizationId,
        wamid,
        input.leadId || null,
        integration.display_phone_number || input.phoneNumberId,
        input.recipientPhone,
        messageType,
        bodyText,
      ],
    );

    const msg = msgRes.rows[0];

    // 4. Record Activity on Lead Timeline if leadId present
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
