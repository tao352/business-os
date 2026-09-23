import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  assertCanAccessIndividualLeadRecords,
  assertPermission,
} from "../permissions/checker.js";
import { assertActiveTenantMember } from "../permissions/tenant-member-guard.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_LOST_REASONS,
  OPEN_OPPORTUNITY_STAGES,
  assertOpportunityLostReason,
  assertOpportunityStage,
  isOpenOpportunityStage,
  recordInitialOpportunityStageInTransaction,
  transitionOpportunityStageInTransaction,
  type OpenOpportunityStage,
  type OpportunityLifecycleRow,
  type OpportunityLostReason,
  type OpportunityStage,
} from "./opportunity-lifecycle.js";

export {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_LOST_REASONS,
  OPEN_OPPORTUNITY_STAGES,
} from "./opportunity-lifecycle.js";
export type {
  OpenOpportunityStage,
  OpportunityLostReason,
  OpportunityStage,
} from "./opportunity-lifecycle.js";

export interface Opportunity extends OpportunityLifecycleRow {
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
  lostReasonCode?: OpportunityLostReason;
  lostReasonNotes?: string | null;
}

export interface UpdateOpportunityStageOptions {
  lostReasonCode?: OpportunityLostReason;
  lostReasonNotes?: string | null;
}

export interface ListOpportunitiesFilters {
  stage?: OpportunityStage;
  leadId?: string;
  assignedUserId?: string;
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
 * domain is the authoritative application boundary for forecast pipeline state;
 * CRM compatibility wrappers delegate here.
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

  if (input.lostReasonCode) {
    assertOpportunityLostReason(input.lostReasonCode);
  }
  if (stage === "LOST" && !input.lostReasonCode) {
    throw new Error("Opportunity lost reason is required");
  }
  if (stage !== "LOST" && (input.lostReasonCode || input.lostReasonNotes)) {
    throw new Error(
      "Opportunity lost reason metadata can only be set when stage is LOST",
    );
  }

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

    const isClosed = stage === "WON" || stage === "LOST";
    const reasonCode = stage === "LOST" ? (input.lostReasonCode ?? null) : null;
    const reasonNotes =
      stage === "LOST" ? input.lostReasonNotes?.trim() || null : null;

    const res = await tx.query<Opportunity>(
      `INSERT INTO deals (
        organization_id, lead_id, title, value, currency,
        stage, expected_close_date, assigned_user_id, custom_data,
        stage_entered_at, closed_at, lost_reason_code, lost_reason_notes
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        NOW(), CASE WHEN $10::boolean THEN NOW() ELSE NULL END, $11, $12
      )
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
        isClosed,
        reasonCode,
        reasonNotes,
      ],
    );

    const opportunity = res.rows[0];
    if (!opportunity) {
      throw new Error("Failed to create opportunity");
    }

    await recordInitialOpportunityStageInTransaction(tx, context, opportunity, {
      reasonCode,
      reasonNotes,
      metadata: { source: "opportunity_created" },
    });

    await recordAuditLog(tx, context, {
      action: "CREATE",
      // Keep the persisted audit discriminator stable during the compatibility
      // phase. Renaming historical audit taxonomy is a separate migration.
      entityType: "deal",
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
        `Deal created: ${opportunity.title} (${opportunity.value} ${opportunity.currency})`,
        JSON.stringify({
          opportunityId: opportunity.id,
          dealId: opportunity.id,
          value: opportunity.value,
          stage,
        }),
      ],
    );

    return opportunity;
  });
}

/**
 * Manually changes forecast pipeline stage for one Opportunity.
 *
 * LOST requires an Opportunity-level reason. LOST can only be reopened through
 * reopenOpportunity(); WON remains terminal in the normal product flow.
 */
export async function updateOpportunityStage(
  context: TenantContext,
  opportunityId: string,
  newStage: OpportunityStage,
  options: UpdateOpportunityStageOptions = {},
): Promise<Opportunity> {
  assertPermission(context, "update", "opportunity");
  assertOpportunityStage(newStage);

  if (options.lostReasonCode) {
    assertOpportunityLostReason(options.lostReasonCode);
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const result = await transitionOpportunityStageInTransaction(
      tx,
      context,
      opportunityId,
      newStage,
      {
        source: "manual",
        authorizeUpdate: true,
        lostReasonCode: options.lostReasonCode,
        lostReasonNotes: options.lostReasonNotes,
      },
    );

    return result.opportunity;
  });
}

/**
 * Explicitly reopens a LOST Opportunity into an open forecast stage.
 */
export async function reopenOpportunity(
  context: TenantContext,
  opportunityId: string,
  targetStage: OpenOpportunityStage = "DISCOVERY",
): Promise<Opportunity> {
  assertPermission(context, "update", "opportunity");

  if (!isOpenOpportunityStage(targetStage)) {
    throw new Error("A reopened Opportunity must target an open stage");
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const result = await transitionOpportunityStageInTransaction(
      tx,
      context,
      opportunityId,
      targetStage,
      {
        source: "opportunity_reopened",
        authorizeUpdate: true,
      },
    );

    return result.opportunity;
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
