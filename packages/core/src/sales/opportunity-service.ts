import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";
import { assertActiveTenantMember } from "../permissions/tenant-member-guard.js";
import { recordAuditLog } from "../crm/audit-helper.js";

export const OPPORTUNITY_STAGES = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export interface Opportunity {
  id: string;
  organization_id: string;
  lead_id: string;
  title: string;
  value: string | number;
  currency: string;
  stage: OpportunityStage;
  expected_close_date: string | Date | null;
  assigned_user_id: string | null;
  custom_data: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
  lead_name?: string;
  assignee_name?: string | null;
}

export interface CreateOpportunityInput {
  leadId: string;
  title: string;
  value: number;
  currency?: string;
  stage?: OpportunityStage;
  expectedCloseDate?: string | null;
  assignedUserId?: string | null;
  customData?: Record<string, unknown>;
}

export interface ListOpportunitiesFilters {
  stage?: OpportunityStage;
  leadId?: string;
  assignedUserId?: string;
}

function assertOpportunityStage(value: string): asserts value is OpportunityStage {
  if (!OPPORTUNITY_STAGES.includes(value as OpportunityStage)) {
    throw new Error(`Invalid Opportunity stage '${value}'`);
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error("Opportunity title is required");
  }
  if (normalized.length > 200) {
    throw new Error("Opportunity title must be 200 characters or fewer");
  }
  return normalized;
}

function assertOpportunityValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Opportunity value must be a finite non-negative number");
  }
}

/**
 * Creates the commercial opportunity attached to a Lead.
 *
 * The physical table remains `deals` during the R1 migration. The Sales
 * domain is now the authoritative application boundary for forecast pipeline
 * state; CRM compatibility wrappers delegate here.
 */
export async function createOpportunity(
  context: TenantContext,
  input: CreateOpportunityInput,
): Promise<Opportunity> {
  assertPermission(context, "create", "opportunity");

  const title = normalizeTitle(input.title);
  assertOpportunityValue(input.value);
  const stage = input.stage ?? "DISCOVERY";
  assertOpportunityStage(stage);

  return await withTenantContext(context.organizationId, async (tx) => {
    const leadRes = await tx.query<{
      id: string;
      assigned_user_id: string | null;
    }>(
      `SELECT id, assigned_user_id
       FROM leads
       WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, input.leadId],
    );
    const lead = leadRes.rows[0];
    if (!lead) {
      throw new Error(`Lead '${input.leadId}' not found`);
    }

    assertCanAccessIndividualLeadRecords(context, lead);

    const assignedUserId = input.assignedUserId ?? context.userId;
    const assignedMember = await assertActiveTenantMember(
      context,
      assignedUserId,
      ["OWNER", "ADMIN", "SALES_MANAGER", "SALESPERSON"],
      tx,
    );

    // During the compatibility phase, a salesperson cannot own an Opportunity
    // for a Lead they cannot open. This prevents creating inaccessible customer
    // records while Lead-level ownership remains the privacy boundary.
    if (
      assignedMember.role === "SALESPERSON" &&
      lead.assigned_user_id !== assignedUserId
    ) {
      throw new Error(
        "Opportunity salesperson must match the Lead assignee during the compatibility phase",
      );
    }

    assertPermission(context, "create", "opportunity", {
      assigned_user_id: assignedUserId,
    });

    const res = await tx.query<Opportunity>(
      `INSERT INTO deals (
        organization_id, lead_id, title, value, currency,
        stage, expected_close_date, assigned_user_id, custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        context.organizationId,
        input.leadId,
        title,
        input.value,
        input.currency?.trim() || "USD",
        stage,
        input.expectedCloseDate ?? null,
        assignedUserId,
        JSON.stringify(input.customData ?? {}),
      ],
    );

    const opportunity = res.rows[0];
    if (!opportunity) {
      throw new Error("Failed to create opportunity");
    }

    await recordAuditLog(tx, context, {
      action: "CREATE",
      entityType: "opportunity",
      entityId: opportunity.id,
      afterState: opportunity as unknown as Record<string, unknown>,
    });

    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'NOTE', $4, $5)`,
      [
        context.organizationId,
        input.leadId,
        context.userId,
        `Opportunity created: ${opportunity.title} (${opportunity.value} ${opportunity.currency})`,
        JSON.stringify({
          opportunityId: opportunity.id,
          value: opportunity.value,
          stage,
        }),
      ],
    );

    return opportunity;
  });
}

/**
 * Changes forecast pipeline stage for one Opportunity.
 */
export async function updateOpportunityStage(
  context: TenantContext,
  opportunityId: string,
  newStage: OpportunityStage,
): Promise<Opportunity> {
  assertPermission(context, "update", "opportunity");
  assertOpportunityStage(newStage);

  return await withTenantContext(context.organizationId, async (tx) => {
    const existingRes = await tx.query<
      Opportunity & { lead_assigned_user_id: string | null }
    >(
      `SELECT d.*, l.assigned_user_id AS lead_assigned_user_id
       FROM deals d
       JOIN leads l
         ON l.organization_id = d.organization_id
        AND l.id = d.lead_id
       WHERE d.organization_id = $1 AND d.id = $2
       FOR UPDATE OF d`,
      [context.organizationId, opportunityId],
    );
    const opportunity = existingRes.rows[0];
    if (!opportunity) {
      throw new Error("Opportunity not found");
    }

    assertPermission(context, "update", "opportunity", opportunity);
    assertCanAccessIndividualLeadRecords(context, {
      assigned_user_id: opportunity.lead_assigned_user_id,
    });

    if (opportunity.stage === newStage) {
      return opportunity;
    }

    const res = await tx.query<Opportunity>(
      `UPDATE deals
       SET stage = $1, updated_at = NOW()
       WHERE organization_id = $2 AND id = $3
       RETURNING *`,
      [newStage, context.organizationId, opportunityId],
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update opportunity stage");
    }

    await recordAuditLog(tx, context, {
      action: "UPDATE",
      entityType: "opportunity",
      entityId: opportunityId,
      beforeState: { stage: opportunity.stage },
      afterState: { stage: newStage },
    });

    await tx.query(
      `INSERT INTO activities (
        organization_id, lead_id, user_id, activity_type, summary, details
      ) VALUES ($1, $2, $3, 'STATUS_CHANGE', $4, $5)`,
      [
        context.organizationId,
        opportunity.lead_id,
        context.userId,
        `Opportunity "${opportunity.title}" stage changed from ${opportunity.stage} to ${newStage}`,
        JSON.stringify({
          opportunityId,
          oldStage: opportunity.stage,
          newStage,
        }),
      ],
    );

    return updated;
  });
}

/**
 * Lists forecast Opportunities. Salespersons are restricted to Opportunities
 * they own for Leads they are also allowed to access.
 */
export async function listOpportunities(
  context: TenantContext,
  filters: ListOpportunitiesFilters = {},
): Promise<Opportunity[]> {
  assertPermission(context, "read", "opportunity");

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
      assertOpportunityStage(filters.stage);
      conditions.push(`d.stage = $${paramIdx++}`);
      params.push(filters.stage);
    }
    if (filters.leadId) {
      conditions.push(`d.lead_id = $${paramIdx++}`);
      params.push(filters.leadId);
    }

    const res = await tx.query<Opportunity>(
      `SELECT
         d.*,
         l.full_name AS lead_name,
         u.full_name AS assignee_name
       FROM deals d
       JOIN leads l
         ON l.organization_id = d.organization_id
        AND l.id = d.lead_id
       LEFT JOIN users u ON u.id = d.assigned_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.created_at DESC`,
      params,
    );

    return res.rows;
  });
}
