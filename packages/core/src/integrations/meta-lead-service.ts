import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  MetaLeadDetails,
  MetaIngestionResult,
  MetaWebhookPayload,
} from "@business-os/types";
import { recordAuditLog } from "../crm/audit-helper.js";
import { recordInitialLeadStageInTransaction } from "../crm/lead-lifecycle.js";
import { parseMetaLeadData } from "./meta-lead-mapper.js";
import { MetaLeadFetcher, DefaultMetaLeadFetcher } from "./meta-fetcher.js";
import { findMetaIntegrationByPageId } from "./meta-integration-service.js";

import { getDecryptedMetaIntegration } from "./credential-service.js";

export interface IngestMetaLeadInput {
  pageId: string;
  leadgenId: string;
  formId?: string;
  adId?: string;
  leadDetails?: MetaLeadDetails;
  rawPayload?: unknown;
  leadFetcher?: MetaLeadFetcher;
}

/**
 * Ingests a Meta Lead into the tenant CRM with idempotency, deduplication, and attribution.
 * External Meta Graph API requests execute strictly outside database transactions.
 */
export async function ingestMetaLead(
  context: TenantContext,
  input: IngestMetaLeadInput,
): Promise<MetaIngestionResult> {
  // 1. Fetch integration configuration with decrypted credentials (short query, no long transaction)
  const integration = await getDecryptedMetaIntegration(context, input.pageId);

  // 2. Fetch lead details from Graph API externally (STRICTLY OUTSIDE DATABASE TRANSACTION)
  let details = input.leadDetails;
  if (!details) {
    const fetcher = input.leadFetcher || new DefaultMetaLeadFetcher();
    details = await fetcher.fetchLeadDetails(
      input.leadgenId,
      integration.page_access_token,
    );
  }

  // 3. Parse field data & campaign attribution
  const parsed = parseMetaLeadData(details, integration.field_mappings || {});

  // 4. Open short tenant database transaction strictly for deduplication & persistence
  return await withTenantContext(context.organizationId, async (tx) => {
    // Idempotency check via webhook_events
    const eventRes = await tx.query(
      `INSERT INTO webhook_events (organization_id, provider, event_id, payload, status)
       VALUES ($1, 'META', $2, $3, 'PENDING')
       ON CONFLICT (organization_id, provider, event_id) DO NOTHING
       RETURNING id, status, lead_id`,
      [
        context.organizationId,
        input.leadgenId,
        JSON.stringify(input.rawPayload || {}),
      ],
    );

    if (eventRes.rows.length === 0) {
      // Event already exists
      const existingEvt = await tx.query(
        `SELECT id, status, lead_id FROM webhook_events
         WHERE organization_id = $1 AND provider = 'META' AND event_id = $2`,
        [context.organizationId, input.leadgenId],
      );
      return {
        success: true,
        action: "DUPLICATE_IGNORED",
        leadId: existingEvt.rows[0]?.lead_id || undefined,
        leadgenId: input.leadgenId,
        pageId: input.pageId,
        message: "Duplicate webhook event received; ignored safely",
      };
    }

    const webhookEventId = eventRes.rows[0].id;

    // 5. Deduplication check by phone number within the organization
    const existingLeadRes = await tx.query(
      `SELECT id, full_name, phone, custom_data FROM leads
       WHERE organization_id = $1 AND phone = $2 LIMIT 1`,
      [context.organizationId, parsed.phone],
    );

    if (existingLeadRes.rows.length > 0) {
      const existingLead = existingLeadRes.rows[0];
      const existingCustom = existingLead.custom_data || {};
      const submissions = Array.isArray(existingCustom.meta_submissions)
        ? existingCustom.meta_submissions
        : [];

      submissions.push({
        leadgen_id: input.leadgenId,
        submitted_at: new Date().toISOString(),
        form_id: parsed.formId,
        form_name: parsed.formName,
        campaign_id: parsed.campaignId,
        campaign_name: parsed.campaignName,
        ad_id: parsed.adId,
        ad_name: parsed.adName,
      });

      const updatedCustom = {
        ...existingCustom,
        meta_submissions: submissions,
      };

      await tx.query(
        `UPDATE leads SET custom_data = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedCustom), existingLead.id],
      );

      // Append Timeline Activity
      await tx.query(
        `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
         VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
        [
          context.organizationId,
          existingLead.id,
          context.userId,
          `Repeat Meta Lead Form Submission: ${parsed.formName || parsed.campaignName || "Lead Ad"}`,
          JSON.stringify({
            leadgen_id: input.leadgenId,
            campaign_id: parsed.campaignId,
            campaign_name: parsed.campaignName,
            ad_id: parsed.adId,
            ad_name: parsed.adName,
            form_id: parsed.formId,
            form_name: parsed.formName,
            questions: parsed.customQuestions,
          }),
        ],
      );

      // Update Webhook Event
      await tx.query(
        `UPDATE webhook_events SET status = 'PROCESSED', lead_id = $1, processed_at = NOW()
         WHERE id = $2`,
        [existingLead.id, webhookEventId],
      );

      return {
        success: true,
        action: "UPDATED",
        leadId: existingLead.id,
        leadgenId: input.leadgenId,
        pageId: input.pageId,
        message: "Existing lead matched and updated with new Meta submission",
      };
    }

    // 6. Create New Lead
    const leadCustomData = {
      ...parsed.customQuestions,
      meta_attribution: {
        leadgen_id: input.leadgenId,
        page_id: input.pageId,
        form_id: parsed.formId,
        form_name: parsed.formName,
        ad_id: parsed.adId,
        ad_name: parsed.adName,
        adset_id: parsed.adsetId,
        adset_name: parsed.adsetName,
        campaign_id: parsed.campaignId,
        campaign_name: parsed.campaignName,
        platform: parsed.platform,
      },
    };

    const newLeadRes = await tx.query(
      `INSERT INTO leads (
        organization_id, full_name, phone, email, status,
        source, campaign_id, custom_data
      ) VALUES ($1, $2, $3, $4, 'NEW', 'FACEBOOK_LEAD_ADS', $5, $6)
      RETURNING *`,
      [
        context.organizationId,
        parsed.fullName,
        parsed.phone,
        parsed.email,
        parsed.campaignId,
        JSON.stringify(leadCustomData),
      ],
    );

    const newLead = newLeadRes.rows[0];

    await recordInitialLeadStageInTransaction(tx, context, newLead.id, "NEW", {
      source: "meta_lead_ads",
      leadgenId: input.leadgenId,
    });

    // Immutable Audit Log
    await recordAuditLog(tx, context, {
      action: "CREATE",
      entityType: "lead",
      entityId: newLead.id,
      afterState: newLead,
    });

    // Timeline Activity Note
    await tx.query(
      `INSERT INTO activities (organization_id, lead_id, user_id, activity_type, summary, details)
       VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        newLead.id,
        context.userId,
        `Meta Lead Captured: ${parsed.campaignName || parsed.formName || "Lead Ad"}`,
        JSON.stringify({
          leadgen_id: input.leadgenId,
          campaign_id: parsed.campaignId,
          campaign_name: parsed.campaignName,
          ad_id: parsed.adId,
          ad_name: parsed.adName,
          form_id: parsed.formId,
          form_name: parsed.formName,
          questions: parsed.customQuestions,
        }),
      ],
    );

    // Update Webhook Event
    await tx.query(
      `UPDATE webhook_events SET status = 'PROCESSED', lead_id = $1, processed_at = NOW()
       WHERE id = $2`,
      [newLead.id, webhookEventId],
    );

    return {
      success: true,
      action: "CREATED",
      leadId: newLead.id,
      leadgenId: input.leadgenId,
      pageId: input.pageId,
      message: "New lead successfully captured from Meta Lead Ads",
    };
  });
}

/**
 * Dispatches an incoming Meta Webhook payload across all configured page integrations.
 */
export async function processMetaWebhookPayload(
  payload: MetaWebhookPayload,
  options?: {
    leadFetcher?: MetaLeadFetcher;
    mockLeadDetailsMap?: Record<string, MetaLeadDetails>;
  },
): Promise<MetaIngestionResult[]> {
  const results: MetaIngestionResult[] = [];

  for (const entry of payload.entry || []) {
    const pageId = entry.id;
    const lookup = await findMetaIntegrationByPageId(pageId);
    if (!lookup) continue;

    const systemContext: TenantContext = {
      userId: lookup.ownerUserId,
      organizationId: lookup.organizationId,
      role: "OWNER",
      correlationId: `meta-webhook-${pageId}-${Date.now()}`,
    };

    for (const change of entry.changes || []) {
      if (change.field === "leadgen" && change.value?.leadgen_id) {
        const leadgenId = change.value.leadgen_id;
        const mockDetails = options?.mockLeadDetailsMap?.[leadgenId];

        const res = await ingestMetaLead(systemContext, {
          pageId,
          leadgenId,
          formId: change.value.form_id,
          adId: change.value.ad_id,
          leadDetails: mockDetails,
          rawPayload: payload,
          leadFetcher: options?.leadFetcher,
        });

        results.push(res);
      }
    }
  }

  return results;
}
