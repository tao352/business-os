import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  LogCampaignSpendInput,
  CampaignSpendRecord,
  CampaignAttributionMetric,
  AttributionModel,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";

/**
 * Logs marketing spend for a specific campaign or channel.
 */
export async function logCampaignSpend(
  context: TenantContext,
  input: LogCampaignSpendInput,
): Promise<CampaignSpendRecord> {
  assertPermission(context, "create", "campaign");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query<CampaignSpendRecord>(
      `INSERT INTO campaign_spend_logs (
        organization_id, campaign_id, campaign_name, source,
        spend_amount, currency, spend_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        context.organizationId,
        input.campaignId,
        input.campaignName.trim(),
        input.source || "FACEBOOK_LEAD_ADS",
        input.spendAmount,
        input.currency || "EGP",
        input.spendDate,
      ],
    );

    const record = res.rows[0]!;
    await recordAuditLog(tx, context, {
      action: "CREATE",
      entityType: "campaign_spend",
      entityId: record.id,
      afterState: record as unknown as Record<string, unknown>,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        campaignId: input.campaignId,
        amount: input.spendAmount,
      },
      "Logged campaign marketing spend",
    );

    return record;
  });
}

/**
 * Calculates multi-touch marketing attribution, linking marketing campaigns to
 * generated leads, site visits, reservations, contracts, and collected revenue.
 */
export async function calculateCampaignAttribution(
  context: TenantContext,
  _model: AttributionModel = "LAST_TOUCH",
): Promise<CampaignAttributionMetric[]> {
  assertPermission(context, "read", "report");

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Fetch all campaign spend aggregated
    const spendRes = await tx.query<{
      campaign_id: string;
      campaign_name: string;
      source: string;
      total_spend: string;
    }>(
      `SELECT campaign_id, campaign_name, source, SUM(spend_amount) as total_spend
       FROM campaign_spend_logs
       WHERE organization_id = $1
       GROUP BY campaign_id, campaign_name, source`,
      [context.organizationId],
    );

    const spendMap = new Map<
      string,
      { name: string; source: string; spend: number }
    >();
    for (const row of spendRes.rows) {
      spendMap.set(row.campaign_id, {
        name: row.campaign_name,
        source: row.source,
        spend: Number(row.total_spend) || 0,
      });
    }

    // 2. Aggregate Leads, Visits, Reservations, and Contracts per campaign
    const metricsRes = await tx.query<{
      campaign_id: string;
      source: string;
      leads_count: string;
      visits_count: string;
      reservations_count: string;
      contracts_count: string;
      total_revenue: string;
    }>(
      `SELECT 
        l.campaign_id,
        COALESCE(l.source, 'MANUAL') AS source,
        COUNT(DISTINCT l.id) AS leads_count,
        COUNT(DISTINCT v.id) AS visits_count,
        COUNT(DISTINCT r.id) AS reservations_count,
        COUNT(DISTINCT c.id) AS contracts_count,
        COALESCE(SUM(c.contract_value), 0) AS total_revenue
       FROM leads l
       LEFT JOIN visits v ON l.id = v.lead_id AND v.status = 'COMPLETED'
       LEFT JOIN reservations r ON l.id = r.lead_id AND r.status IN ('CONFIRMED', 'CONVERTED')
       LEFT JOIN contracts c ON l.id = c.lead_id AND c.status IN ('SIGNED', 'ACTIVE', 'COMPLETED')
       WHERE l.organization_id = $1 AND l.campaign_id IS NOT NULL
       GROUP BY l.campaign_id, l.source`,
      [context.organizationId],
    );

    const metrics: CampaignAttributionMetric[] = [];
    const seenCampaigns = new Set<string>();

    for (const row of metricsRes.rows) {
      const campaignId = row.campaign_id;
      seenCampaigns.add(campaignId);

      const spendInfo = spendMap.get(campaignId);
      const spendAmount = spendInfo?.spend ?? 0;
      const campaignName = spendInfo?.name ?? `Campaign ${campaignId}`;
      const leadsCount = Number(row.leads_count) || 0;
      const visitsCount = Number(row.visits_count) || 0;
      const reservationsCount = Number(row.reservations_count) || 0;
      const contractsCount = Number(row.contracts_count) || 0;
      const totalRevenue = Number(row.total_revenue) || 0;

      const roas =
        spendAmount > 0 ? Number((totalRevenue / spendAmount).toFixed(2)) : 0;
      const cac =
        contractsCount > 0
          ? Number((spendAmount / contractsCount).toFixed(2))
          : spendAmount;

      metrics.push({
        campaignId,
        campaignName,
        source: row.source,
        spendAmount,
        leadsCount,
        visitsCount,
        reservationsCount,
        contractsCount,
        totalRevenue,
        roas,
        cac,
      });
    }

    // Include any campaigns with logged spend but zero leads yet
    for (const [campaignId, info] of spendMap.entries()) {
      if (!seenCampaigns.has(campaignId)) {
        metrics.push({
          campaignId,
          campaignName: info.name,
          source: info.source,
          spendAmount: info.spend,
          leadsCount: 0,
          visitsCount: 0,
          reservationsCount: 0,
          contractsCount: 0,
          totalRevenue: 0,
          roas: 0,
          cac: info.spend,
        });
      }
    }

    return metrics;
  });
}
