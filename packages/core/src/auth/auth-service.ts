import { pool, withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type { TenantRole } from "@business-os/types";
import { hashPassword, verifyPassword } from "./password.js";
import { issueTenantToken } from "./jwt.js";
import { listActiveOrganizationsForUser } from "./membership-bootstrap.js";

export interface RegisterUserInput {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthenticateResult {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: TenantRole;
  }>;
  primaryToken?: string;
}

/**
 * Registers a new global user account with hashed password.
 *
 * users is a global identity/control-plane table in the current schema.
 * Tenant business data remains RLS protected.
 */
export async function registerUser(input: RegisterUserInput) {
  const emailNormalized = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [emailNormalized],
    );

    if (existing.rows.length > 0) {
      throw new Error("User with this email already exists");
    }

    const res = await client.query(
      `INSERT INTO users (email, full_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, created_at`,
      [emailNormalized, input.fullName.trim(), passwordHash],
    );

    return res.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Authenticates credentials, then uses the narrow pre-tenant bootstrap router
 * to enumerate active organization memberships.
 *
 * The password MUST be verified before membership enumeration.
 */
export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthenticateResult> {
  const emailNormalized = email.trim().toLowerCase();

  const client = await pool.connect();
  let user: {
    id: string;
    email: string;
    full_name: string;
    password_hash: string;
    is_active: boolean;
  };

  try {
    const userRes = await client.query(
      `SELECT id, email, full_name, password_hash, is_active
       FROM users
       WHERE email = $1`,
      [emailNormalized],
    );

    if (userRes.rows.length === 0) {
      throw new Error("Invalid email or password");
    }

    user = userRes.rows[0];

    if (!user.is_active) {
      throw new Error("User account is suspended");
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error("Invalid email or password");
    }
  } finally {
    client.release();
  }

  // Pre-tenant bootstrap is intentionally called ONLY after password verification.
  const organizations = await listActiveOrganizationsForUser(user.id);

  let primaryToken: string | undefined;
  const firstOrg = organizations[0];

  if (firstOrg) {
    primaryToken = await issueTenantToken({
      userId: user.id,
      organizationId: firstOrg.id,
      role: firstOrg.role,
      email: user.email,
    });
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
    },
    organizations,
    primaryToken,
  };
}

/**
 * Provisions a new tenant organization and atomically assigns the creator OWNER.
 *
 * No privileged router is needed:
 * once the organization row exists, its tenant ID is known, so the transaction
 * binds app.current_tenant_id before inserting the FORCE-RLS membership row.
 */
export async function createOrganization(params: {
  userId: string;
  name: string;
  slug: string;
  plan?: "STARTER" | "GROWTH" | "ENTERPRISE";
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Always execute the mutation as the least-privilege runtime role,
    // even when a test harness happens to connect using a migrator/admin pool.
    await client.query("SET LOCAL ROLE app_user");

    const orgRes = await client.query(
      `INSERT INTO organizations (name, slug, plan)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, plan, created_at`,
      [
        params.name.trim(),
        params.slug.trim().toLowerCase(),
        params.plan || "STARTER",
      ],
    );

    const org = orgRes.rows[0];

    // The tenant is now known. Bind the new org before writing memberships.
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      org.id,
    ]);

    await client.query(
      `INSERT INTO organization_memberships (
         organization_id,
         user_id,
         role,
         is_active
       )
       VALUES ($1, $2, 'OWNER', true)`,
      [org.id, params.userId],
    );

    await client.query("COMMIT");

    logger.info(
      { organizationId: org.id, userId: params.userId },
      "Successfully created new organization and assigned OWNER",
    );

    return org;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Switches to an organization the user actively belongs to.
 *
 * targetOrganizationId is already known, so normal tenant RLS is the correct
 * authorization primitive. No pre-tenant router is used here.
 */
export async function switchOrganization(params: {
  userId: string;
  targetOrganizationId: string;
  email: string;
}): Promise<string> {
  const membership = await withTenantContext(
    params.targetOrganizationId,
    async (client) => {
      const res = await client.query<{
        role: TenantRole;
        is_active: boolean;
      }>(
        `SELECT role, is_active
         FROM organization_memberships
         WHERE user_id = $1
           AND organization_id = $2`,
        [params.userId, params.targetOrganizationId],
      );

      const row = res.rows[0];
      if (!row) {
        throw new Error("User does not have access to this organization");
      }

      return row;
    },
  );

  if (!membership.is_active) {
    throw new Error("Membership in this organization is deactivated");
  }

  return issueTenantToken({
    userId: params.userId,
    organizationId: params.targetOrganizationId,
    role: membership.role,
    email: params.email,
  });
}
