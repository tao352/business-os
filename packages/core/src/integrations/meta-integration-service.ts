import { pool, withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  MetaIntegration,
  ConfigureMetaIntegrationInput,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from "../security/crypto-service.js";
import { resolveMetaTenant } from "./credential-service.js";

/**
 * Saves or updates Meta Page credentials and configuration for an organization.
 * Sensitive tokens are strictly encrypted using authenticated AES-256-GCM.
 */
export async function configureMetaIntegration(
  context: TenantContext,
  input: ConfigureMetaIntegrationInput,
): Promise<MetaIntegration> {
  assertPermission(context, "manage", "organization");

  const encryptedAccessToken = encryptSecret(input.pageAccessToken);
  const encryptedAppSecret = encryptSecret(input.appSecret);
  const encryptedVerifyToken = encryptSecret(input.verifyToken);

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
        encryptedAccessToken,
        encryptedAppSecret,
        encryptedVerifyToken,
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
      pageAccessToken: maskSecret(row.page_access_token),
      appSecret: maskSecret(row.app_secret),
      verifyToken: maskSecret(row.verify_token),
      isActive: row.is_active,
      fieldMappings: row.field_mappings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Looks up an active Meta integration by page_id outside tenant context (pre-routing),
 * decrypting credentials for internal API communication.
 */
export async function findMetaIntegrationByPageId(pageId: string): Promise<{
  organizationId: string;
  ownerUserId: string;
  integration: MetaIntegration;
} | null> {
  const routing = await resolveMetaTenant(pageId);
  if (!routing) return null;

  return await withTenantContext(routing.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT m.*, om.user_id as owner_user_id
       FROM meta_integrations m
       LEFT JOIN organization_memberships om ON om.organization_id = m.organization_id AND om.role = 'OWNER'
       WHERE m.id = $1 AND m.is_active = true
       LIMIT 1`,
      [routing.integrationId],
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
        pageAccessToken: decryptSecret(row.page_access_token),
        appSecret: decryptSecret(row.app_secret),
        verifyToken: decryptSecret(row.verify_token),
        isActive: row.is_active,
        fieldMappings: row.field_mappings,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  });
}
