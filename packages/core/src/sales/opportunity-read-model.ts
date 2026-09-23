import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";
import type {
  Opportunity,
  OpportunityStage,
} from "./opportunity-service.js";

export interface OpportunityListItem extends Opportunity {
  lead_name: string;
  lead_phone: string;
  lead_source: string;
  assignee_name: string | null;
}

export interface ListOpportunitiesPageFilters {
  search?: string;
  stage?: OpportunityStage;
  assignedUserId?: string;
  page?: number;
  pageSize?: number;
}

export interface OpportunitiesPageResult {
  opportunities: OpportunityListItem[];
  totalCount: number;
}

export interface OpportunityStageHistoryItem {
  id: string;
  opportunity_id: string;
  from_stage: OpportunityStage | null;
  to_stage: OpportunityStage;
  changed_by_user_id: string | null;
  changed_by_name: string | null;
  transition_source: string;
  reason_code: string | null;
  reason_notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string | Date;
}

export interface OpportunityWorkspace {
  opportunity: OpportunityListItem;
  history: OpportunityStageHistoryItem[];
}

/**
 * Paginated Sales read model for the Opportunities workspace.
 *
 * Salespersons are restricted to Opportunities they own for Leads they are also
 * assigned to. All access remains tenant-scoped inside withTenantContext().
 */
export async function listOpportunitiesPage(
  context: TenantContext,
  filters: ListOpportunitiesPageFilters = {},
): Promise<OpportunitiesPageResult> {
  assertPermission(context, "read", "opportunity");
  assertCanAccessIndividualLeadRecords(context);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const search = filters.search?.trim() || null;

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ["d.organization_id = $1"];
    const params: unknown[] = [context.organizationId];
    let paramIdx = 2;

    if (context.role === "SALESPERSON") {
      conditions.push(`d.assigned_user_id = $${paramIdx++}`);
      params.push(context.userId);
      conditions.push(`l.assigned_user_id = $${paramIdx++}`);
      params.push(context.userId);
    } else if (filters.assignedUserId) {
      conditions.push(`d.assigned_user_id = $${paramIdx++}`);
      params.push(filters.assignedUserId);
    }

    if (filters.stage) {
      conditions.push(`d.stage = $${paramIdx++}`);
      params.push(filters.stage);
    }

    if (search) {
      conditions.push(
        `(d.title ILIKE $${paramIdx} OR l.full_name ILIKE $${paramIdx})`,
      );
      params.push(`%${search}%`);
      paramIdx += 1;
    }

    const where = conditions.join(" AND ");

    const countRes = await tx.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM deals d
       JOIN leads l
         ON l.organization_id = d.organization_id
        AND l.id = d.lead_id
       WHERE ${where}`,
      params,
    );

    const listParams = [...params, pageSize, offset];
    const limitParam = paramIdx++;
    const offsetParam = paramIdx;

    const listRes = await tx.query<OpportunityListItem>(
      `SELECT
         d.*,
         l.full_name AS lead_name,
         l.phone AS lead_phone,
         l.source AS lead_source,
         u.full_name AS assignee_name
       FROM deals d
       JOIN leads l
         ON l.organization_id = d.organization_id
        AND l.id = d.lead_id
       LEFT JOIN users u ON u.id = d.assigned_user_id
       WHERE ${where}
       ORDER BY
         CASE d.stage
           WHEN 'NEGOTIATION' THEN 1
           WHEN 'PROPOSAL' THEN 2
           WHEN 'DISCOVERY' THEN 3
           WHEN 'WON' THEN 4
           WHEN 'LOST' THEN 5
           ELSE 6
         END,
         d.updated_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      listParams,
    );

    return {
      opportunities: listRes.rows,
      totalCount: Number(countRes.rows[0]?.count ?? 0),
    };
  });
}

/**
 * Loads one Opportunity and its immutable stage history for the Sales workspace.
 */
export async function getOpportunityWorkspace(
  context: TenantContext,
  opportunityId: string,
): Promise<OpportunityWorkspace> {
  assertPermission(context, "read", "opportunity");

  return await withTenantContext(context.organizationId, async (tx) => {
    const opportunityRes = await tx.query<
      OpportunityListItem & { lead_assigned_user_id: string | null }
    >(
      `SELECT
         d.*,
         l.full_name AS lead_name,
         l.phone AS lead_phone,
         l.source AS lead_source,
         l.assigned_user_id AS lead_assigned_user_id,
         u.full_name AS assignee_name
       FROM deals d
       JOIN leads l
         ON l.organization_id = d.organization_id
        AND l.id = d.lead_id
       LEFT JOIN users u ON u.id = d.assigned_user_id
       WHERE d.organization_id = $1 AND d.id = $2`,
      [context.organizationId, opportunityId],
    );

    const opportunity = opportunityRes.rows[0];
    if (!opportunity) {
      throw new Error("Opportunity not found");
    }

    assertPermission(context, "read", "opportunity", {
      assigned_user_id: opportunity.assigned_user_id,
    });
    assertCanAccessIndividualLeadRecords(context, {
      assigned_user_id: opportunity.lead_assigned_user_id,
    });

    const historyRes = await tx.query<OpportunityStageHistoryItem>(
      `SELECT
         h.id,
         h.opportunity_id,
         h.from_stage,
         h.to_stage,
         h.changed_by_user_id,
         usr.full_name AS changed_by_name,
         h.transition_source,
         h.reason_code,
         h.reason_notes,
         h.metadata,
         h.created_at
       FROM opportunity_stage_history h
       LEFT JOIN users usr ON usr.id = h.changed_by_user_id
       WHERE h.organization_id = $1 AND h.opportunity_id = $2
       ORDER BY h.created_at DESC, h.id DESC`,
      [context.organizationId, opportunityId],
    );

    const {
      lead_assigned_user_id: _leadAssignedUserId,
      ...safeOpportunity
    } = opportunity;

    return {
      opportunity: safeOpportunity,
      history: historyRes.rows,
    };
  });
}
