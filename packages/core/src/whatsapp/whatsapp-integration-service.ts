import { pool, withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  WhatsAppIntegration,
  ConfigureWhatsAppInput,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from "../security/crypto-service.js";
import { resolveWhatsAppTenant } from "../integrations/credential-service.js";

/**
 * Saves or updates WhatsApp Business Account credentials for an organization.
 * All sensitive API keys are encrypted at rest using AES-256-GCM.
 */
export async function configureWhatsAppIntegration(
  context: TenantContext,
  input: ConfigureWhatsAppInput,
): Promise<WhatsAppIntegration> {
  assertPermission(context, "manage", "organization");

  const encryptedAccessToken = encryptSecret(input.accessToken);
  const encryptedAppSecret = input.appSecret
    ? encryptSecret(input.appSecret)
    : "";
  const encryptedVerifyToken = encryptSecret(input.verifyToken);

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `INSERT INTO whatsapp_integrations (
        organization_id, phone_number_id, waba_id, phone_number,
        access_token, app_secret, verify_token, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (organization_id, phone_number_id) DO UPDATE SET
        waba_id = EXCLUDED.waba_id,
        phone_number = EXCLUDED.phone_number,
        access_token = EXCLUDED.access_token,
        app_secret = EXCLUDED.app_secret,
        verify_token = EXCLUDED.verify_token,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *`,
      [
        context.organizationId,
        input.phoneNumberId,
        input.wabaId,
        input.phoneNumber || null,
        encryptedAccessToken,
        encryptedAppSecret,
        encryptedVerifyToken,
        input.isActive ?? true,
      ],
    );

    const row = res.rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      phoneNumberId: row.phone_number_id,
      wabaId: row.waba_id,
      phoneNumber: row.phone_number,
      accessToken: maskSecret(row.access_token),
      appSecret: maskSecret(row.app_secret),
      verifyToken: maskSecret(row.verify_token),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Looks up an active WhatsApp integration by phone_number_id outside tenant context (pre-routing),
 * decrypting credentials for outbound Graph API communication.
 */
export async function findWhatsAppIntegrationByPhoneNumberId(
  phoneNumberId: string,
): Promise<{
  organizationId: string;
  ownerUserId: string;
  integration: WhatsAppIntegration;
} | null> {
  const routing = await resolveWhatsAppTenant(phoneNumberId);
  if (!routing) return null;

  return await withTenantContext(routing.organizationId, async (tx) => {
    const res = await tx.query(
      `SELECT w.*, om.user_id as owner_user_id
       FROM whatsapp_integrations w
       LEFT JOIN organization_memberships om ON om.organization_id = w.organization_id AND om.role = 'OWNER'
       WHERE w.id = $1 AND w.is_active = true
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
        phoneNumberId: row.phone_number_id,
        wabaId: row.waba_id,
        phoneNumber: row.phone_number,
        accessToken: decryptSecret(row.access_token),
        appSecret: decryptSecret(row.app_secret),
        verifyToken: decryptSecret(row.verify_token),
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  });
}
