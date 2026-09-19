import { z } from "zod";

export const AttributionModelSchema = z.enum([
  "FIRST_TOUCH",
  "LAST_TOUCH",
  "LINEAR",
]);
export type AttributionModel = z.infer<typeof AttributionModelSchema>;

export interface LogCampaignSpendInput {
  campaignId: string;
  campaignName: string;
  source?: string;
  spendAmount: number;
  currency?: string;
  spendDate: string; // YYYY-MM-DD
}

export interface CampaignSpendRecord {
  id: string;
  organization_id: string;
  campaign_id: string;
  campaign_name: string;
  source: string;
  spend_amount: number;
  currency: string;
  spend_date: string;
  created_at: Date;
}

export interface CampaignAttributionMetric {
  campaignId: string;
  campaignName: string;
  source: string;
  spendAmount: number;
  leadsCount: number;
  visitsCount: number;
  reservationsCount: number;
  contractsCount: number;
  totalRevenue: number;
  roas: number; // Return on Ad Spend (totalRevenue / spendAmount)
  cac: number; // Customer Acquisition Cost (spendAmount / contractsCount)
}

export interface SalesLeaderboardEntry {
  userId: string;
  fullName: string;
  assignedLeads: number;
  completedVisits: number;
  contractsCount: number;
  totalRevenue: number;
}

export interface ExecutiveDashboardKpis {
  totalLeads: number;
  activeLeads: number;
  totalVisits: number;
  totalReservations: number;
  totalContracts: number;
  pipelineValue: number;
  collectedDeposits: number;
  leadToVisitRate: number; // (totalVisits / totalLeads) * 100
  visitToContractRate: number; // (totalContracts / totalVisits) * 100
  salesLeaderboard: SalesLeaderboardEntry[];
  inventoryStatus: {
    availableUnits: number;
    reservedUnits: number;
    contractedUnits: number;
    totalUnitsValue: number;
  };
}
