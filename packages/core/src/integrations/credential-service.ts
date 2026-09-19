import { pool, withTenantContext } from "@business-os/database";
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

export interface TenantRoutingResult {
  organizationId: string;
  integrationId: string;
}

/**
 * Pre-routing helper using SECURITY DEFINER function resolve_meta_tenant.
 * Resolves only organizationId and integrationId before a TenantContext exists,
 * without exposing secrets or credentials.
 */
export async function resolveMetaTenant(
  pageId: string,
): Promise<TenantRoutingResult | null> {
  const res = await pool.query(
    `SELECT organization_id, integration_id FROM public.resolve_meta_tenant($1)`,
    [pageId],
  );
  if (res.rows.length === 0) return null;
  return {
    organizationId: res.rows[0].organization_id,
    integrationId: res.rows[0].integration_id,
  };
}

/**
 * Pre-routing helper using SECURITY DEFINER function resolve_whatsapp_tenant.
 * Resolves only organizationId and integrationId before a TenantContext exists,
 * without exposing secrets or credentials.
 */
export async function resolveWhatsAppTenant(
  phoneNumberId: string,
): Promise<TenantRoutingResult | null> {
  const res = await pool.query(
    `SELECT organization_id, integration_id FROM public.resolve_whatsapp_tenant($1)`,
    [phoneNumberId],
  );
  if (res.rows.length === 0) return null;
  return {
    organizationId: res.rows[0].organization_id,
    integrationId: res.rows[0].integration_id,
  };
}

/**
 * Retrieves Meta Integration with decrypted credentials.
 * Ensures business logic never receives encrypted ciphertext.
 * Always executes within a tenant-scoped session to satisfy FORCE RLS under runtime app_user.
 */
export async function getDecryptedMetaIntegration(
  context: TenantContext,
  pageId: string,
  customClient?: TransactionClient,
): Promise<DecryptedMetaIntegration> {
  const executeQuery = async (client: TransactionClient) => {
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
  };

  if (customClient) {
    return executeQuery(customClient);
  }

  return withTenantContext(context.organizationId, (tx) => executeQuery(tx));
}

/**
 * Retrieves WhatsApp Integration with decrypted credentials by phone number ID.
 * Always executes within a tenant-scoped session to satisfy FORCE RLS under runtime app_user.
 */
export async function getDecryptedWhatsAppIntegration(
  context: TenantContext,
  phoneNumberId: string,
  customClient?: TransactionClient,
): Promise<DecryptedWhatsAppIntegration> {
  const executeQuery = async (client: TransactionClient) => {
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
  };

  if (customClient) {
    return executeQuery(customClient);
  }

  return withTenantContext(context.organizationId, (tx) => executeQuery(tx));
}

/**
 * Retrieves WhatsApp Integration with decrypted credentials by internal ID.
 * Always executes within a tenant-scoped session to satisfy FORCE RLS under runtime app_user.
 */
export async function getDecryptedWhatsAppIntegrationById(
  context: TenantContext,
  integrationId: string,
  customClient?: TransactionClient,
): Promise<DecryptedWhatsAppIntegration> {
  const executeQuery = async (client: TransactionClient) => {
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
  };

  if (customClient) {
    return executeQuery(customClient);
  }

  return withTenantContext(context.organizationId, (tx) => executeQuery(tx));
}
