import crypto from "node:crypto";
import { pool } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  FeatureFlag,
  SetFeatureFlagInput,
} from "@business-os/types";

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

    // 2. Specific Tenant Targeting
    if (context?.organizationId) {
      const targetTenants: string[] = flag.target_tenants || [];
      if (targetTenants.includes(context.organizationId)) {
        return true;
      }

      // 3. Percentage-Based Rollout
      if (flag.percentage > 0) {
        const hash = crypto
          .createHash("md5")
          .update(`${flagKey}:${context.organizationId}`)
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

export async function setFeatureFlag(
  input: SetFeatureFlagInput,
  adminContext?: TenantContext,
): Promise<FeatureFlag> {
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
      adminId: adminContext?.userId,
      enabledGlobally,
      percentage,
      targetsCount: targetTenants.length,
    },
    "Feature flag updated successfully",
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
