import { pool } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import { decryptSecret } from "../security/crypto-service.js";
import type { TransactionClient } from "../crm/audit-helper.js";

export interface DecryptedMetaIntegration {
  id: string;
  organization_id: string;
  page_id: string;
  page_name: string;
  page_access_token: string;
  app_secret?: string | null;
  field_mappings: Record<string, string>;
  is_active: boolean;
}

export interface DecryptedWhatsAppIntegration {
  id: string;
  organization_id: string;
  phone_number_id: string;
  waba_id: string;
  display_phone_number?: string | null;
  access_token: string;
  app_secret?: string | null;
  webhook_verify_token?: string | null;
  is_active: boolean;
}

/**
 * Retrieves Meta Integration with decrypted credentials.
 * Ensures business logic never receives encrypted ciphertext.
 */
export async function getDecryptedMetaIntegration(
  context: TenantContext,
  pageId: string,
  customClient?: TransactionClient,
): Promise<DecryptedMetaIntegration> {
  const client = customClient || (await pool.connect());
  const shouldRelease =
    !customClient &&
    "release" in client &&
    typeof (client as any).release === "function";

  try {
    const res = await client.query(
      `SELECT * FROM meta_integrations
       WHERE organization_id = $1 AND page_id = $2 AND is_active = true`,
      [context.organizationId, pageId],
    );

    if (res.rows.length === 0) {
      throw new Error(
        `No active Meta integration found for page [${pageId}] in organization [${context.organizationId}]`,
      );
    }

    const row = res.rows[0];
    return {
      ...row,
      page_access_token: decryptSecret(row.page_access_token),
      app_secret: row.app_secret ? decryptSecret(row.app_secret) : null,
    };
  } finally {
    if (shouldRelease) {
      (client as any).release();
    }
  }
}

/**
 * Retrieves WhatsApp Integration with decrypted credentials by phone number ID.
 */
export async function getDecryptedWhatsAppIntegration(
  context: TenantContext,
  phoneNumberId: string,
  customClient?: TransactionClient,
): Promise<DecryptedWhatsAppIntegration> {
  const client = customClient || (await pool.connect());
  const shouldRelease =
    !customClient &&
    "release" in client &&
    typeof (client as any).release === "function";

  try {
    const res = await client.query(
      `SELECT * FROM whatsapp_integrations
       WHERE organization_id = $1 AND phone_number_id = $2 AND is_active = true`,
      [context.organizationId, phoneNumberId],
    );

    if (res.rows.length === 0) {
      throw new Error(
        `No active WhatsApp integration found for phone_number_id [${phoneNumberId}] in organization [${context.organizationId}]`,
      );
    }

    const row = res.rows[0];
    return {
      ...row,
      access_token: decryptSecret(row.access_token),
      app_secret: row.app_secret ? decryptSecret(row.app_secret) : null,
    };
  } finally {
    if (shouldRelease) {
      (client as any).release();
    }
  }
}

/**
 * Retrieves WhatsApp Integration with decrypted credentials by internal ID.
 */
export async function getDecryptedWhatsAppIntegrationById(
  context: TenantContext,
  integrationId: string,
  customClient?: TransactionClient,
): Promise<DecryptedWhatsAppIntegration> {
  const client = customClient || (await pool.connect());
  const shouldRelease =
    !customClient &&
    "release" in client &&
    typeof (client as any).release === "function";

  try {
    const res = await client.query(
      `SELECT * FROM whatsapp_integrations
       WHERE organization_id = $1 AND id = $2 AND is_active = true`,
      [context.organizationId, integrationId],
    );

    if (res.rows.length === 0) {
      throw new Error(
        `No active WhatsApp integration found with ID [${integrationId}] in organization [${context.organizationId}]`,
      );
    }

    const row = res.rows[0];
    return {
      ...row,
      access_token: decryptSecret(row.access_token),
      app_secret: row.app_secret ? decryptSecret(row.app_secret) : null,
    };
  } finally {
    if (shouldRelease) {
      (client as any).release();
    }
  }
}
