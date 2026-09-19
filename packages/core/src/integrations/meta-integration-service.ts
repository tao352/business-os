import { pool, withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  MetaIntegration,
  ConfigureMetaIntegrationInput,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";

/**
 * Saves or updates Meta Page credentials and configuration for an organization.
 */
export async function configureMetaIntegration(
  context: TenantContext,
  input: ConfigureMetaIntegrationInput,
): Promise<MetaIntegration> {
  assertPermission(context, "manage", "organization");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `INSERT INTO meta_integrations (
        organization_id, page_id, page_name, page_access_token,
        app_secret, verify_token, is_active, field_mappings, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (organization_id, page_id) DO UPDATE SET
        page_name = EXCLUDED.page_name,
        page_access_token = EXCLUDED.page_access_token,
        app_secret = EXCLUDED.app_secret,
        verify_token = EXCLUDED.verify_token,
        is_active = EXCLUDED.is_active,
        field_mappings = EXCLUDED.field_mappings,
        updated_at = NOW()
      RETURNING *`,
      [
        context.organizationId,
        input.pageId,
        input.pageName || null,
        input.pageAccessToken,
        input.appSecret,
        input.verifyToken,
        input.isActive ?? true,
        JSON.stringify(input.fieldMappings || {}),
      ],
    );

    const row = res.rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      pageId: row.page_id,
      pageName: row.page_name,
      pageAccessToken: row.page_access_token,
      appSecret: row.app_secret,
      verifyToken: row.verify_token,
      isActive: row.is_active,
      fieldMappings: row.field_mappings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Looks up an active Meta integration by page_id outside tenant context (pre-routing).
 */
export async function findMetaIntegrationByPageId(pageId: string): Promise<{
  organizationId: string;
  ownerUserId: string;
  integration: MetaIntegration;
} | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT m.*, om.user_id as owner_user_id
       FROM meta_integrations m
       LEFT JOIN organization_memberships om ON om.organization_id = m.organization_id AND om.role = 'OWNER'
       WHERE m.page_id = $1 AND m.is_active = true
       LIMIT 1`,
      [pageId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      integration: {
        id: row.id,
        organizationId: row.organization_id,
        pageId: row.page_id,
        pageName: row.page_name,
        pageAccessToken: row.page_access_token,
        appSecret: row.app_secret,
        verifyToken: row.verify_token,
        isActive: row.is_active,
        fieldMappings: row.field_mappings,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  } finally {
    client.release();
  }
}
