import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  ExecutiveDashboardKpis,
  SalesLeaderboardEntry,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";

/**
 * Aggregates high-performance real estate executive dashboard KPIs and sales leaderboards.
 */
export async function getExecutiveDashboard(
  context: TenantContext,
): Promise<ExecutiveDashboardKpis> {
  assertPermission(context, "read", "report");

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Leads Funnel Counts
    const leadsRes = await tx.query<{
      total_leads: string;
      active_leads: string;
    }>(
      `SELECT 
        COUNT(*) AS total_leads,
        COUNT(*) FILTER (WHERE status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'MEETING_SCHEDULED', 'SITE_VISIT_BOOKED')) AS active_leads
       FROM leads
       WHERE organization_id = $1`,
      [context.organizationId],
    );

    const totalLeads = Number(leadsRes.rows[0]?.total_leads) || 0;
    const activeLeads = Number(leadsRes.rows[0]?.active_leads) || 0;

    // 2. Visits, Reservations, Contracts counts
    const funnelRes = await tx.query<{
      total_visits: string;
      total_reservations: string;
      total_contracts: string;
      collected_deposits: string;
    }>(
      `SELECT 
        (SELECT COUNT(*) FROM visits WHERE organization_id = $1) AS total_visits,
        (SELECT COUNT(*) FROM reservations WHERE organization_id = $1 AND status IN ('CONFIRMED', 'CONVERTED')) AS total_reservations,
        (SELECT COUNT(*) FROM contracts WHERE organization_id = $1 AND status = 'SIGNED') AS total_contracts,
        COALESCE((SELECT SUM(deposit_amount) FROM reservations WHERE organization_id = $1 AND status IN ('CONFIRMED', 'CONVERTED')), 0) AS collected_deposits`,
      [context.organizationId],
    );

    const totalVisits = Number(funnelRes.rows[0]?.total_visits) || 0;
    const totalReservations =
      Number(funnelRes.rows[0]?.total_reservations) || 0;
    const totalContracts = Number(funnelRes.rows[0]?.total_contracts) || 0;
    const collectedDeposits =
      Number(funnelRes.rows[0]?.collected_deposits) || 0;

    // 3. Pipeline Value (from open deals)
    const dealsRes = await tx.query<{ pipeline_value: string }>(
      `SELECT COALESCE(SUM(value), 0) AS pipeline_value
       FROM deals
       WHERE organization_id = $1 AND stage != 'LOST'`,
      [context.organizationId],
    );
    const pipelineValue = Number(dealsRes.rows[0]?.pipeline_value) || 0;

    // 4. Funnel Conversion Rates
    const leadToVisitRate =
      totalLeads > 0
        ? Number(((totalVisits / totalLeads) * 100).toFixed(1))
        : 0;
    const visitToContractRate =
      totalVisits > 0
        ? Number(((totalContracts / totalVisits) * 100).toFixed(1))
        : 0;

    // 5. Sales Leaderboard
    const leaderboardRes = await tx.query<{
      user_id: string;
      full_name: string;
      assigned_leads: string;
      completed_visits: string;
      contracts_count: string;
      total_revenue: string;
    }>(
      `SELECT 
        u.id AS user_id,
        u.full_name,
        COUNT(DISTINCT l.id) AS assigned_leads,
        COUNT(DISTINCT v.id) FILTER (WHERE v.status = 'COMPLETED') AS completed_visits,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'SIGNED') AS contracts_count,
        COALESCE(SUM(c.contract_value) FILTER (WHERE c.status = 'SIGNED'), 0) AS total_revenue
       FROM users u
       JOIN organization_memberships om ON u.id = om.user_id AND om.organization_id = $1
       LEFT JOIN leads l ON u.id = l.assigned_user_id AND l.organization_id = $1
       LEFT JOIN visits v ON u.id = v.assigned_agent_id AND v.organization_id = $1
       LEFT JOIN contracts c ON l.id = c.lead_id AND c.organization_id = $1
       WHERE om.role IN ('SALESPERSON', 'SALES_MANAGER', 'OWNER')
       GROUP BY u.id, u.full_name
       HAVING COUNT(DISTINCT l.id) > 0 OR COUNT(DISTINCT v.id) > 0 OR COUNT(DISTINCT c.id) > 0
       ORDER BY total_revenue DESC, contracts_count DESC`,
      [context.organizationId],
    );

    const salesLeaderboard: SalesLeaderboardEntry[] = leaderboardRes.rows.map(
      (row) => ({
        userId: row.user_id,
        fullName: row.full_name,
        assignedLeads: Number(row.assigned_leads) || 0,
        completedVisits: Number(row.completed_visits) || 0,
        contractsCount: Number(row.contracts_count) || 0,
        totalRevenue: Number(row.total_revenue) || 0,
      }),
    );

    // 6. Inventory Status
    const unitsRes = await tx.query<{
      available_units: string;
      reserved_units: string;
      contracted_units: string;
      total_units_value: string;
    }>(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available_units,
        COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved_units,
        COUNT(*) FILTER (WHERE status = 'CONTRACTED') AS contracted_units,
        COALESCE(SUM(price), 0) AS total_units_value
       FROM units
       WHERE organization_id = $1`,
      [context.organizationId],
    );

    const inventoryStatus = {
      availableUnits: Number(unitsRes.rows[0]?.available_units) || 0,
      reservedUnits: Number(unitsRes.rows[0]?.reserved_units) || 0,
      contractedUnits: Number(unitsRes.rows[0]?.contracted_units) || 0,
      totalUnitsValue: Number(unitsRes.rows[0]?.total_units_value) || 0,
    };

    return {
      totalLeads,
      activeLeads,
      totalVisits,
      totalReservations,
      totalContracts,
      pipelineValue,
      collectedDeposits,
      leadToVisitRate,
      visitToContractRate,
      salesLeaderboard,
      inventoryStatus,
    };
  });
}
