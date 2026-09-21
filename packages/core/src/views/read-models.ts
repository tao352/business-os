import { withTenantContext } from "@business-os/database";
import type { TenantContext, LeadStatus, Lead, Task } from "@business-os/types";
import {
  assertPermission,
  can,
  assertCanAccessIndividualLeadRecords,
} from "../permissions/checker.js";
import { ForbiddenError } from "../permissions/types.js";
import { listOrganizationMembers } from "../permissions/member-service.js";
import { getLead, listLeads } from "../crm/lead-service.js";
import { listLeadActivities } from "../crm/activity-service.js";
import { listTasks } from "../crm/task-service.js";

// ==============================================================================
// 1. DASHBOARD OVERVIEW READ MODEL
// ==============================================================================

export interface DashboardActivity {
  id: string;
  lead_id: string;
  user_id: string;
  author_name: string;
  lead_name?: string | null;
  activity_type: string;
  summary: string;
  created_at: string | Date;
}

export interface DashboardOverviewData {
  totalLeads: number;
  newLeads: number;
  openTasks: number;
  dueFollowups: number;
  recentActivities: DashboardActivity[];
  recentLeads: Lead[];
  openTasksList: Task[];
}

/**
 * High-performance dashboard read model.
 * Strictly role-aware: for SALESPERSON, scopes lead counts, task counts, and
 * recent activities to only records/leads assigned to the authenticated user.
 * For MARKETING_USER, returns aggregated KPI metrics while strictly withholding
 * individual dossiers, activities, and tasks.
 */
export async function getDashboardOverview(
  context: TenantContext,
): Promise<DashboardOverviewData> {
  if (!can(context, "read", "lead") && !can(context, "read_all", "lead")) {
    throw new ForbiddenError(context.role, "read", "lead");
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const isSalesperson = context.role === "SALESPERSON";
    const isMarketingUser = context.role === "MARKETING_USER";
    const leadFilter = isSalesperson ? "WHERE assigned_user_id = $1" : "";
    const params = isSalesperson ? [context.userId] : [];

    // 1. Aggregated KPI Counts
    const leadCounts = await tx.query(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE status = 'NEW') as new_leads
       FROM leads ${leadFilter}`,
      params,
    );

    // MARKETING_USER is strictly aggregate-only: no individual customer records, activities, or tasks
    if (isMarketingUser) {
      return {
        totalLeads: parseInt(leadCounts.rows[0]?.total_leads || "0", 10),
        newLeads: parseInt(leadCounts.rows[0]?.new_leads || "0", 10),
        openTasks: 0,
        dueFollowups: 0,
        recentActivities: [],
        recentLeads: [],
        openTasksList: [],
      };
    }

    const taskFilter = isSalesperson
      ? "WHERE assigned_user_id = $1"
      : "WHERE 1=1";

    const taskCounts = await tx.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_completed = false) as open_tasks,
        COUNT(*) FILTER (WHERE is_completed = false AND due_date <= NOW()) as due_followups
       FROM tasks ${taskFilter}`,
      params,
    );

    // 2. Chronological Recent Activities
    // If SALESPERSON: MUST ONLY see activities on leads assigned to them!
    let activitiesQuery: string;
    let activitiesParams: unknown[] = [];

    if (isSalesperson) {
      activitiesQuery = `
        SELECT a.id, a.lead_id, a.user_id, u.full_name as author_name,
               l.full_name as lead_name, a.activity_type, a.summary, a.created_at
        FROM activities a
        JOIN users u ON u.id = a.user_id
        JOIN leads l ON l.id = a.lead_id
        WHERE l.assigned_user_id = $1
        ORDER BY a.created_at DESC
        LIMIT 6
      `;
      activitiesParams = [context.userId];
    } else {
      activitiesQuery = `
        SELECT a.id, a.lead_id, a.user_id, u.full_name as author_name,
               l.full_name as lead_name, a.activity_type, a.summary, a.created_at
        FROM activities a
        JOIN users u ON u.id = a.user_id
        LEFT JOIN leads l ON l.id = a.lead_id
        ORDER BY a.created_at DESC
        LIMIT 6
      `;
    }

    const activitiesRes = await tx.query(activitiesQuery, activitiesParams);
    const recentActivities: DashboardActivity[] = activitiesRes.rows;

    // 3. Recent Leads (Role-constrained via core lead service)
    const recentLeads = (await listLeads(context, { limit: 5 })) as Lead[];

    // 4. Open Tasks (Role-constrained via core task service)
    const openTasks = (await listTasks(context, {
      isCompleted: false,
    })) as unknown as Task[];
    const openTasksList = openTasks.slice(0, 5);

    return {
      totalLeads: parseInt(leadCounts.rows[0]?.total_leads || "0", 10),
      newLeads: parseInt(leadCounts.rows[0]?.new_leads || "0", 10),
      openTasks: parseInt(taskCounts.rows[0]?.open_tasks || "0", 10),
      dueFollowups: parseInt(taskCounts.rows[0]?.due_followups || "0", 10),
      recentActivities,
      recentLeads,
      openTasksList,
    };
  });
}

// ==============================================================================
// 2. LEADS PAGE LISTING READ MODEL (WITH SERVER-SIDE PII PROTECTION)
// ==============================================================================

export interface ListLeadsPageFilters {
  search?: string;
  status?: LeadStatus;
  assignee?: string;
  page?: number;
  pageSize?: number;
}

export interface LeadPageRow {
  id: string;
  full_name?: string;
  phone?: string;
  email?: string | null;
  status: LeadStatus;
  source: string;
  assigned_name?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  contact_info_redacted?: boolean;
}

export interface ListLeadsPageResult {
  leads: LeadPageRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  individualRecordsRestricted?: boolean;
}

/**
 * Paginated and filtered Leads listing read model.
 * Strictly enforces aggregate-only access: for MARKETING_USER, individual
 * records are withheld (empty array), returning totalCount and individualRecordsRestricted: true.
 * For SALESPERSON, strictly filters by assigned_user_id.
 */
export async function listLeadsPage(
  context: TenantContext,
  filters: ListLeadsPageFilters = {},
): Promise<ListLeadsPageResult> {
  if (!can(context, "read", "lead") && !can(context, "read_all", "lead")) {
    throw new ForbiddenError(context.role, "read", "lead");
  }

  const currentPage = Math.max(1, filters.page || 1);
  const pageSize = Math.min(Math.max(filters.pageSize || 20, 1), 100);
  const offset = (currentPage - 1) * pageSize;

  if (context.role === "MARKETING_USER") {
    return await withTenantContext(context.organizationId, async (tx) => {
      const countRes = await tx.query("SELECT COUNT(*) as total FROM leads");
      const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);
      return {
        leads: [],
        totalCount,
        page: 1,
        pageSize,
        individualRecordsRestricted: true,
      };
    });
  }

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ["1 = 1"];
    const queryParams: unknown[] = [];
    let idx = 1;

    // Row-level ownership constraint for SALESPERSON
    if (context.role === "SALESPERSON") {
      conditions.push(`l.assigned_user_id = $${idx++}`);
      queryParams.push(context.userId);
    } else if (filters.assignee) {
      conditions.push(`l.assigned_user_id = $${idx++}`);
      queryParams.push(filters.assignee);
    }

    if (filters.status) {
      conditions.push(`l.status = $${idx++}`);
      queryParams.push(filters.status);
    }

    if (filters.search && filters.search.trim().length > 0) {
      conditions.push(
        `(l.full_name ILIKE $${idx} OR l.phone ILIKE $${idx} OR l.email ILIKE $${idx})`,
      );
      queryParams.push(`%${filters.search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.join(" AND ");

    // 1. Total Count Query
    const countRes = await tx.query(
      `SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`,
      queryParams,
    );
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    // 2. Paginated Data Query
    const selectQuery = `
      SELECT l.id, l.full_name, l.phone, l.email, l.status, l.source,
             u.full_name as assigned_name, l.created_at, l.updated_at
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_user_id
      WHERE ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    const rowsRes = await tx.query(selectQuery, [
      ...queryParams,
      pageSize,
      offset,
    ]);

    const leads: LeadPageRow[] = rowsRes.rows;

    return {
      leads,
      totalCount,
      page: currentPage,
      pageSize,
    };
  });
}

// ==============================================================================
// 3. LEAD DETAIL WORKSPACE READ MODEL
// ==============================================================================

export interface LeadActivityItem {
  id: string;
  lead_id: string;
  user_id: string;
  author_name: string;
  activity_type: string;
  summary: string;
  details?: Record<string, unknown> | null;
  created_at: string | Date;
}

export interface LeadWorkspaceData {
  lead: Lead & { contact_info_redacted?: boolean };
  assignedName: string | null;
  activities: LeadActivityItem[];
  tasks: Task[];
  members: Array<{ user_id: string; full_name: string; role: string }>;
}

/**
 * Complete Lead detail workspace read model.
 * Asserts individual lead access permission (throws ForbiddenError for MARKETING_USER),
 * verifies row-level ownership, loads timeline activities, tasks, and assignable members.
 */
export async function getLeadWorkspace(
  context: TenantContext,
  leadId: string,
): Promise<LeadWorkspaceData> {
  assertCanAccessIndividualLeadRecords(context);

  const rawLead = (await getLead(context, leadId)) as Lead;
  const lead = { ...rawLead };

  // 1. Fetch assigned agent name safely
  let assignedName: string | null = null;
  if (lead.assigned_user_id) {
    const memberRes = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const res = await tx.query(
          "SELECT full_name, email FROM users WHERE id = $1",
          [lead.assigned_user_id],
        );
        return res.rows[0];
      },
    );
    if (memberRes) {
      assignedName = memberRes.full_name || memberRes.email;
    }
  }

  // 2. Fetch timeline activities and follow-up tasks
  const activities = (await listLeadActivities(
    context,
    leadId,
  )) as LeadActivityItem[];
  const tasks = (await listTasks(context, { leadId })) as unknown as Task[];

  // 3. Fetch assignable organization members if caller has permission
  let members: Array<{ user_id: string; full_name: string; role: string }> = [];
  if (can(context, "read", "member")) {
    try {
      const rawMembers = await listOrganizationMembers(context);
      members = rawMembers.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name || m.email,
        role: m.role,
      }));
    } catch {
      // If not permitted, members array remains empty
    }
  }

  return {
    lead,
    assignedName,
    activities,
    tasks,
    members,
  };
}

// ==============================================================================
// 4. REAL ESTATE PROJECTS OVERVIEW READ MODEL
// ==============================================================================

export interface ProjectOverviewItem {
  id: string;
  name: string;
  location: string;
  description?: string | null;
  project_type: string;
  construction_status: string;
  sales_status: string;
  is_active: boolean;
  total_units: number;
  units_count: number;
  available_units: number;
  created_at: string | Date;
}

/**
 * Retrieves projects portfolio with truthfully aggregated unit counts.
 */
export async function listProjectsOverview(
  context: TenantContext,
): Promise<ProjectOverviewItem[]> {
  assertPermission(context, "read", "project");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(`
      SELECT p.id, p.name, p.location, p.description, p.project_type,
             p.construction_status, p.sales_status, p.is_active,
             p.total_units, p.created_at,
             COUNT(u.id)::int as units_count,
             COUNT(u.id) FILTER (WHERE u.status = 'AVAILABLE')::int as available_units
      FROM projects p
      LEFT JOIN units u ON u.project_id = p.id
      GROUP BY p.id
      ORDER BY p.name ASC
    `);

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      description: row.description,
      project_type: row.project_type || "COMMERCIAL",
      construction_status: row.construction_status || "UNDER_CONSTRUCTION",
      sales_status: row.sales_status || "SELLING",
      is_active: Boolean(row.is_active),
      total_units: Number(row.total_units) || 0,
      units_count: Number(row.units_count) || 0,
      available_units: Number(row.available_units) || 0,
      created_at: row.created_at,
    }));
  });
}

// ==============================================================================
// 5. UNITS INVENTORY READ MODEL (TRUTHFUL PAGINATION & TOTAL COUNT)
// ==============================================================================

export interface ListUnitsInventoryFilters {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: string;
  usageType?: string;
  unitType?: string;
  floor?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface UnitInventoryItem {
  id: string;
  unit_number: string;
  usage_type: string;
  unit_type: string;
  model_name?: string | null;
  floor?: string | null;
  gross_area: number;
  price: number;
  currency: string;
  status: string;
  is_active: boolean;
  project_name: string;
  project_id: string;
}

export interface ListUnitsResult {
  units: UnitInventoryItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated property units inventory read model with truthful total count.
 */
export async function listUnitsInventory(
  context: TenantContext,
  filters: ListUnitsInventoryFilters = {},
): Promise<ListUnitsResult> {
  assertPermission(context, "read", "unit");

  const currentPage = Math.max(1, filters.page || 1);
  const pageSize = Math.min(Math.max(filters.pageSize || 25, 1), 100);
  const offset = (currentPage - 1) * pageSize;

  return await withTenantContext(context.organizationId, async (tx) => {
    const conditions: string[] = ["1 = 1"];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.projectId) {
      conditions.push(`u.project_id = $${idx++}`);
      params.push(filters.projectId);
    }

    if (filters.status) {
      conditions.push(`u.status = $${idx++}`);
      params.push(filters.status);
    }

    if (filters.usageType) {
      conditions.push(`u.usage_type = $${idx++}`);
      params.push(filters.usageType);
    }

    if (filters.unitType) {
      conditions.push(`u.unit_type = $${idx++}`);
      params.push(filters.unitType);
    }

    if (filters.floor) {
      conditions.push(`u.floor = $${idx++}`);
      params.push(filters.floor);
    }

    if (filters.minPrice !== undefined) {
      conditions.push(`u.price >= $${idx++}`);
      params.push(filters.minPrice);
    }

    if (filters.maxPrice !== undefined) {
      conditions.push(`u.price <= $${idx++}`);
      params.push(filters.maxPrice);
    }

    const whereClause = conditions.join(" AND ");

    const countRes = await tx.query(
      `SELECT COUNT(*)::int as total FROM units u WHERE ${whereClause}`,
      params,
    );
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    const dataRes = await tx.query(
      `SELECT u.id, u.unit_number, u.usage_type, u.unit_type, u.model_name, u.floor, u.gross_area, u.price,
              u.currency, u.status, u.is_active, u.project_id, p.name as project_name
       FROM units u
       JOIN projects p ON p.id = u.project_id
       WHERE ${whereClause}
       ORDER BY u.unit_number ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, pageSize, offset],
    );

    const units: UnitInventoryItem[] = dataRes.rows.map((row) => ({
      id: row.id,
      unit_number: row.unit_number,
      usage_type: row.usage_type || "COMMERCIAL",
      unit_type: row.unit_type || "RETAIL_STORE",
      model_name: row.model_name,
      floor: row.floor,
      gross_area: Number(row.gross_area) || 0,
      price: Number(row.price) || 0,
      currency: row.currency || "EGP",
      status: row.status,
      is_active: Boolean(row.is_active),
      project_name: row.project_name,
      project_id: row.project_id,
    }));

    return {
      units,
      totalCount,
      page: currentPage,
      pageSize,
    };
  });
}

// ==============================================================================
// 5.1 LEAD INVENTORY MATCHING ENGINE READ MODEL (1:N DETERMINISTIC MATCHING)
// ==============================================================================

export interface MatchedUnitItem extends UnitInventoryItem {
  matchScore: number;
  matchReasons: string[];
}

/**
 * Deterministic lead inventory matching engine.
 * Matches available inventory against active lead property interests (1:N).
 * Ranks matched units by composite satisfaction without subjective lead scoring.
 */
export async function getLeadMatchedUnits(
  context: TenantContext,
  leadId: string,
): Promise<MatchedUnitItem[]> {
  assertCanAccessIndividualLeadRecords(context);

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Fetch Lead existence
    const leadRes = await tx.query(`SELECT id FROM leads WHERE id = $1`, [
      leadId,
    ]);
    if (leadRes.rows.length === 0) {
      throw new Error(`Lead '${leadId}' not found`);
    }

    // 2. Fetch Active Property Interests for this Lead
    const interestsRes = await tx.query(
      `
      SELECT * FROM lead_property_interests
      WHERE lead_id = $1 AND status = 'ACTIVE'
      ORDER BY is_primary DESC, created_at DESC
    `,
      [leadId],
    );

    const activeInterests = interestsRes.rows;
    if (activeInterests.length === 0) {
      return [];
    }

    // 3. Fetch Available Units with Project metadata
    const unitsRes = await tx.query(`
      SELECT u.id, u.unit_number, u.usage_type, u.unit_type, u.model_name, u.floor, u.gross_area,
             u.price, u.currency, u.status, u.is_active, u.project_id, p.name as project_name
      FROM units u
      JOIN projects p ON p.id = u.project_id
      WHERE u.status = 'AVAILABLE' AND u.is_active = true
      ORDER BY u.unit_number ASC
    `);

    const availableUnits = unitsRes.rows;
    const matchedUnits: MatchedUnitItem[] = [];

    for (const row of availableUnits) {
      const unit: UnitInventoryItem = {
        id: row.id,
        unit_number: row.unit_number,
        usage_type: row.usage_type || "COMMERCIAL",
        unit_type: row.unit_type || "RETAIL_STORE",
        model_name: row.model_name,
        floor: row.floor,
        gross_area: Number(row.gross_area) || 0,
        price: Number(row.price) || 0,
        currency: row.currency || "EGP",
        status: row.status,
        is_active: Boolean(row.is_active),
        project_name: row.project_name,
        project_id: row.project_id,
      };

      let bestScore = 0;
      let bestReasons: string[] = [];

      // Evaluate against all active interests for this lead; keep the best matching profile
      for (const interest of activeInterests) {
        let score = 0;
        const reasons: string[] = [];

        // Explicit Specific Unit Request
        if (
          interest.specific_unit_id &&
          interest.specific_unit_id === unit.id
        ) {
          score += 50;
          reasons.push("Specific unit requested by lead");
        }

        // Project Matching
        if (interest.project_id && interest.project_id === unit.project_id) {
          score += 30;
          reasons.push(`Matches preferred project (${unit.project_name})`);
        }

        // Usage Type Matching (e.g. COMMERCIAL, MEDICAL, RESIDENTIAL)
        if (interest.usage_type) {
          const prefUsage = interest.usage_type.trim().toUpperCase();
          const unitUsage = unit.usage_type.trim().toUpperCase();
          if (prefUsage === unitUsage) {
            score += 20;
            reasons.push(`Matches preferred usage (${unit.usage_type})`);
          }
        }

        // Unit Type Matching (e.g. CLINIC, APARTMENT, RETAIL_STORE)
        if (interest.unit_type) {
          const prefType = interest.unit_type.trim().toUpperCase();
          const unitType = unit.unit_type.trim().toUpperCase();
          if (prefType === unitType) {
            score += 25;
            reasons.push(`Matches preferred type (${unit.unit_type})`);
          } else if (
            unitType.includes(prefType) ||
            prefType.includes(unitType)
          ) {
            score += 15;
            reasons.push(`Similar type (${unit.unit_type})`);
          }
        }

        // Budget Matching
        const budgetMin =
          interest.budget_min !== null && interest.budget_min !== undefined
            ? Number(interest.budget_min)
            : null;
        const budgetMax =
          interest.budget_max !== null && interest.budget_max !== undefined
            ? Number(interest.budget_max)
            : null;

        if (budgetMin !== null && budgetMax !== null) {
          if (unit.price >= budgetMin && unit.price <= budgetMax) {
            score += 25;
            reasons.push("Within target budget range");
          } else if (unit.price <= budgetMax * 1.1) {
            score += 10;
            reasons.push("Slightly above target budget (< 10%)");
          }
        } else if (budgetMax !== null) {
          if (unit.price <= budgetMax) {
            score += 25;
            reasons.push("Within maximum budget");
          }
        } else if (budgetMin !== null) {
          if (unit.price >= budgetMin) {
            score += 15;
            reasons.push("Meets minimum budget");
          }
        }

        // Area Matching
        const areaMin =
          interest.area_min !== null && interest.area_min !== undefined
            ? Number(interest.area_min)
            : null;
        const areaMax =
          interest.area_max !== null && interest.area_max !== undefined
            ? Number(interest.area_max)
            : null;

        if (areaMin !== null && areaMax !== null) {
          if (unit.gross_area >= areaMin && unit.gross_area <= areaMax) {
            score += 20;
            reasons.push("Within target area range");
          }
        } else if (areaMin !== null) {
          if (unit.gross_area >= areaMin) {
            score += 15;
            reasons.push("Meets minimum area");
          }
        } else if (areaMax !== null) {
          if (unit.gross_area <= areaMax) {
            score += 15;
            reasons.push("Within maximum area");
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestReasons = reasons;
        }
      }

      if (bestScore > 0) {
        matchedUnits.push({
          ...unit,
          matchScore: bestScore,
          matchReasons: bestReasons,
        });
      }
    }

    matchedUnits.sort(
      (a, b) => b.matchScore - a.matchScore || a.price - b.price,
    );
    return matchedUnits;
  });
}

// ==============================================================================
// 6. EXTERNAL INTEGRATION STATUS READ MODEL (ZERO SECRETS EXPOSURE)
// ==============================================================================

export interface IntegrationStatusResult {
  meta: {
    connected: boolean;
    pageName?: string;
    pageIdMasked?: string;
    updatedAt?: string | Date;
  };
  whatsapp: {
    connected: boolean;
    phoneDisplay?: string;
    phoneNumberIdMasked?: string;
    updatedAt?: string | Date;
  };
}

/**
 * Queries meta_integrations and whatsapp_integrations securely.
 * Asserts read permission on organization configuration.
 * Masking helper to ensure zero token or secret leakage.
 */
export async function getIntegrationStatus(
  context: TenantContext,
): Promise<IntegrationStatusResult> {
  assertPermission(context, "read", "organization");

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Meta Lead Ads Integration
    const metaRes = await tx.query(
      `SELECT page_id, page_name, is_active, updated_at
       FROM meta_integrations
       WHERE organization_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [context.organizationId],
    );

    const metaRow = metaRes.rows[0];
    const meta = metaRow
      ? {
          connected: Boolean(metaRow.is_active),
          pageName: metaRow.page_name || undefined,
          pageIdMasked: metaRow.page_id
            ? `••••${metaRow.page_id.slice(-4)}`
            : undefined,
          updatedAt: metaRow.updated_at,
        }
      : { connected: false };

    // 2. WhatsApp Cloud API Integration
    const waRes = await tx.query(
      `SELECT phone_number_id, phone_number, is_active, updated_at
       FROM whatsapp_integrations
       WHERE organization_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [context.organizationId],
    );

    const waRow = waRes.rows[0];
    const whatsapp = waRow
      ? {
          connected: Boolean(waRow.is_active),
          phoneDisplay: waRow.phone_number || undefined,
          phoneNumberIdMasked: waRow.phone_number_id
            ? `••••${waRow.phone_number_id.slice(-4)}`
            : undefined,
          updatedAt: waRow.updated_at,
        }
      : { connected: false };

    return { meta, whatsapp };
  });
}

// ==============================================================================
// 7. AUTOMATION & SMART RULES READ MODEL
// ==============================================================================

export interface AutomationRuleItem {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  is_active: boolean;
  version: number;
  execution_count: number;
  last_triggered_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * Lists automation rules using the authentic automation_rules schema.
 * Asserts read permission on smart_rule.
 */
export async function listAutomationRules(
  context: TenantContext,
): Promise<AutomationRuleItem[]> {
  assertPermission(context, "read", "smart_rule");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT id, name, description, trigger_type, is_active, version,
              execution_count, last_triggered_at, created_at, updated_at
       FROM automation_rules
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [context.organizationId],
    );

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      trigger_type: row.trigger_type,
      is_active: Boolean(row.is_active),
      version: Number(row.version) || 1,
      execution_count: Number(row.execution_count) || 0,
      last_triggered_at: row.last_triggered_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  });
}

// ==============================================================================
// 8. ORGANIZATION SETTINGS READ MODEL
// ==============================================================================

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "••••••••";
  const parts = email.split("@");
  const user = parts[0];
  const domain = parts[1];
  if (!user || !domain || user.length <= 2) {
    return `*@${domain || ""}`;
  }
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

export interface OrganizationSettingsData {
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    created_at: string | Date;
  } | null;
  members: Array<{
    id: string;
    user_id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    created_at: string | Date;
  }>;
}

/**
 * Retrieves workspace profile and active team members.
 * Requires read permission on organization.
 * Only populates members if caller has permission to read member;
 * for non-admin/owner roles, masks member emails.
 */
export async function getOrganizationSettings(
  context: TenantContext,
): Promise<OrganizationSettingsData> {
  assertPermission(context, "read", "organization");

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Fetch organization details
    const orgRes = await tx.query(
      "SELECT id, name, slug, plan, created_at FROM organizations WHERE id = $1",
      [context.organizationId],
    );
    const organization = orgRes.rows[0] || null;

    // 2. Fetch members if caller has permission
    let members: OrganizationSettingsData["members"] = [];
    if (can(context, "read", "member")) {
      try {
        const rawMembers = await listOrganizationMembers(context);
        const isPrivileged =
          context.role === "OWNER" || context.role === "ADMIN";
        members = rawMembers.map((m) => ({
          id: m.id,
          user_id: m.user_id,
          email: isPrivileged ? m.email : maskEmail(m.email),
          full_name: m.full_name || m.email,
          role: m.role,
          is_active: Boolean(m.is_active),
          created_at: m.created_at,
        }));
      } catch {
        members = [];
      }
    }

    return {
      organization,
      members,
    };
  });
}
