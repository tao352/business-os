import crypto from "node:crypto";
import { pool } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  FeatureFlag,
  SetFeatureFlagInput,
} from "@business-os/types";

export interface PlatformAdminContext {
  isPlatformAdmin: true;
  adminId: string;
  email?: string;
}

export class PlatformAuthorizationError extends Error {
  constructor(
    message = "Only authorized platform administrators can configure platform feature flags",
  ) {
    super(message);
    this.name = "PlatformAuthorizationError";
  }
}

/**
 * Feature Flags Service: Controls rollout of new platform capabilities,
 * pilot modules, and beta features per tenant or percentage (Master Plan Section 42).
 */

export async function isFeatureEnabled(
  flagKey: string,
  context?: TenantContext,
): Promise<boolean> {
  try {
    const res = await pool.query(
      `SELECT key, enabled_globally, target_tenants, percentage FROM feature_flags WHERE key = $1`,
      [flagKey],
    );

    if (res.rows.length === 0) {
      return false;
    }

    const flag = res.rows[0];

    // 1. Global Kill-Switch / Rollout
    if (flag.enabled_globally) {
      return true;
    }

    // 2. Specific Tenant Targeting (Beta / Pilot Customers)
    if (context?.organizationId) {
      const targets = flag.target_tenants || [];
      if (targets.includes(context.organizationId)) {
        return true;
      }

      // 3. Deterministic Percentage Rollout based on Organization ID
      if (flag.percentage > 0) {
        const hash = crypto
          .createHash("sha256")
          .update(`${context.organizationId}:${flagKey}`)
          .digest("hex");
        const bucket = parseInt(hash.substring(0, 4), 16) % 100;
        return bucket < flag.percentage;
      }
    }

    return false;
  } catch (err) {
    logger.error(
      { flagKey, err },
      "Failed to evaluate feature flag, defaulting to false",
    );
    return false;
  }
}

/**
 * Creates or updates a feature flag.
 * Strictly requires platform administrator authorization.
 */
export async function setFeatureFlag(
  input: SetFeatureFlagInput,
  adminContext?: PlatformAdminContext | TenantContext,
): Promise<FeatureFlag> {
  const isAuthorized =
    adminContext &&
    "isPlatformAdmin" in adminContext &&
    adminContext.isPlatformAdmin === true;

  if (!isAuthorized) {
    throw new PlatformAuthorizationError(
      "Only authorized platform administrators can configure platform feature flags. Tenant admins and owners cannot mutate platform flags.",
    );
  }

  const targetTenants = input.target_tenants || [];
  const percentage = input.percentage ?? 0;
  const enabledGlobally = input.enabled_globally ?? false;
  const metadata = input.metadata || {};

  const res = await pool.query(
    `INSERT INTO feature_flags (
      key, name, description, enabled_globally, target_tenants, percentage, metadata, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      description = COALESCE(EXCLUDED.description, feature_flags.description),
      enabled_globally = EXCLUDED.enabled_globally,
      target_tenants = EXCLUDED.target_tenants,
      percentage = EXCLUDED.percentage,
      metadata = EXCLUDED.metadata,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      input.key,
      input.name,
      input.description || null,
      enabledGlobally,
      targetTenants,
      percentage,
      JSON.stringify(metadata),
    ],
  );

  const flag = res.rows[0];

  logger.info(
    {
      flagKey: input.key,
      enabledGlobally,
      percentage,
      targetsCount: targetTenants.length,
    },
    "Feature flag updated successfully by authorized administrator",
  );

  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    enabled_globally: flag.enabled_globally,
    target_tenants: flag.target_tenants,
    percentage: flag.percentage,
    metadata: flag.metadata,
    created_at: flag.created_at,
    updated_at: flag.updated_at,
  };
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const res = await pool.query(`SELECT * FROM feature_flags ORDER BY key ASC`);
  return res.rows;
}
