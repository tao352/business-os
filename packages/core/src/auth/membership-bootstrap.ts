import { pool } from "@business-os/database";
import type { TenantRole } from "@business-os/types";

export interface ActiveOrganizationMembership {
  id: string;
  name: string;
  slug: string;
  role: TenantRole;
}

/**
 * The ONLY pre-tenant membership enumeration path.
 *
 * organization_memberships is FORCE-RLS protected. Before login has selected
 * a tenant, normal RLS cannot enumerate all organizations for a user.
 *
 * The backing SQL function is a narrowly scoped SECURITY DEFINER router that
 * returns only organization identity + role, and is executable only by app_user.
 *
 * IMPORTANT:
 * - Call this only after application identity has been established
 *   (password verified or JWT signature verified).
 * - Never use this helper to read business data.
 */
export async function listActiveOrganizationsForUser(
  userId: string,
): Promise<ActiveOrganizationMembership[]> {
  const result = await pool.query<{
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    role: TenantRole;
  }>(
    `SELECT
       organization_id,
       organization_name,
       organization_slug,
       role
     FROM public.auth_list_active_memberships($1::uuid)`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.organization_id,
    name: row.organization_name,
    slug: row.organization_slug,
    role: row.role,
  }));
}
