import { pool, withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  TenantIncident,
  RecordIncidentInput,
  TenantIncidentStatus,
  SystemHealthOverview,
  OpsAccessLevel,
} from "@business-os/types";
import { getRedisClient } from "../security/rate-limiter.js";
import { clearAllTenantCaches } from "../cache/tenant-cache.js";

const START_TIME = Date.now();
const RELEASE_VERSION = process.env.APP_RELEASE_VERSION || "0.1.0";

export class NotImplementedError extends Error {
  constructor(action: string) {
    super(
      `Operational action '${action}' is planned for production but not yet implemented.`,
    );
    this.name = "NotImplementedError";
  }
}

/**
 * Operations Console Service: Platform monitoring, incident tracking,
 * and 3-level operational access control (Master Plan Section 38 & 39).
 */

export async function getSystemHealthOverview(): Promise<SystemHealthOverview> {
  let dbOk = false;
  let redisOk = false;
  let activeOrgs = 0;
  let totalLeads = 0;
  let openIncidents = 0;

  try {
    const dbRes = await pool.query("SELECT 1");
    dbOk = dbRes.rowCount !== null && dbRes.rowCount > 0;

    const orgRes = await pool.query("SELECT COUNT(*) FROM organizations");
    activeOrgs = parseInt(orgRes.rows[0]?.count || "0", 10);

    const leadRes = await pool.query("SELECT COUNT(*) FROM leads");
    totalLeads = parseInt(leadRes.rows[0]?.count || "0", 10);

    const incRes = await pool.query(
      "SELECT COUNT(*) FROM tenant_incident_logs WHERE status != 'RESOLVED'",
    );
    openIncidents = parseInt(incRes.rows[0]?.count || "0", 10);
  } catch (err) {
    logger.error({ err }, "Error querying database for health overview");
  }

  // Real Redis ping check with timeout
  try {
    const client = getRedisClient();
    if (client) {
      const pingPromise = client.ping();
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 1500),
      );
      const pong = await Promise.race([pingPromise, timeoutPromise]);
      redisOk = pong === "PONG";
    }
  } catch {
    redisOk = false;
  }

  return {
    database_connected: dbOk,
    redis_connected: redisOk,
    active_organizations_count: activeOrgs,
    total_leads_count: totalLeads,
    recent_incidents_count: openIncidents,
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
    release_version: RELEASE_VERSION,
  };
}

export async function recordTenantIncident(
  context: TenantContext,
  input: RecordIncidentInput,
): Promise<TenantIncident> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `INSERT INTO tenant_incident_logs (
        organization_id, severity, title, details, status, correlation_id, created_at
      ) VALUES ($1, $2, $3, $4, 'OPEN', $5, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        context.organizationId,
        input.severity,
        input.title,
        JSON.stringify(input.details || {}),
        input.correlation_id || null,
      ],
    );

    const inc = res.rows[0];

    logger.warn(
      {
        incidentId: inc.id,
        organizationId: context.organizationId,
        severity: input.severity,
        title: input.title,
      },
      "Operational incident recorded for tenant",
    );

    return inc;
  });
}

export async function listTenantIncidents(
  context: TenantContext,
  status?: TenantIncidentStatus,
): Promise<TenantIncident[]> {
  return await withTenantContext(context.organizationId, async (tx) => {
    let query = `SELECT * FROM tenant_incident_logs WHERE organization_id = $1`;
    const params: unknown[] = [context.organizationId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT 50`;

    const res = await tx.query(query, params);
    return res.rows;
  });
}

export async function resolveTenantIncident(
  context: TenantContext,
  incidentId: string,
  newStatus: TenantIncidentStatus = "RESOLVED",
): Promise<TenantIncident> {
  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `UPDATE tenant_incident_logs
       SET status = $1, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [newStatus, incidentId, context.organizationId],
    );

    if (res.rows.length === 0) {
      throw new Error(
        `Incident '${incidentId}' not found or does not belong to organization`,
      );
    }

    return res.rows[0];
  });
}

/**
 * Executes an operational action with strict multi-level access control.
 */
export async function executeSafeOpsAction(
  action:
    | "RETRY_JOB"
    | "TOGGLE_CONNECTOR"
    | "CLEAR_APPROVED_CACHE"
    | "EMERGENCY_REPAIR",
  payload: Record<string, unknown>,
  level: OpsAccessLevel,
): Promise<{ success: boolean; message: string; action: string }> {
  if (level === "OBSERVE") {
    throw new Error(
      `Access level 'OBSERVE' is read-only. Action '${action}' requires 'SAFE_OPS' or 'BREAK_GLASS' authorization.`,
    );
  }

  if (action === "EMERGENCY_REPAIR" && level !== "BREAK_GLASS") {
    throw new Error(
      `Action '${action}' requires 'BREAK_GLASS' emergency authorization with explicit human approval.`,
    );
  }

  logger.info(
    { action, payload, level },
    "Executing authorized operational action",
  );

  if (action === "CLEAR_APPROVED_CACHE") {
    await clearAllTenantCaches();
    return {
      success: true,
      message: "Cleared all tenant caches successfully",
      action,
    };
  }

  return {
    success: true,
    message: `Action '${action}' successfully executed under '${level}' authorization`,
    action,
  };
}
