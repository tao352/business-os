import { pool } from "@business-os/database";
import { logger } from "@business-os/logger";
import type { TenantRole } from "@business-os/types";
import { hashPassword, verifyPassword } from "./password.js";
import { issueTenantToken, type TenantTokenPayload } from "./jwt.js";

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
 * Authenticates user credentials and returns their memberships and an initial session token if they have an active org.
 */
export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthenticateResult> {
  const emailNormalized = email.trim().toLowerCase();

  const client = await pool.connect();
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

    const user = userRes.rows[0];
    if (!user.is_active) {
      throw new Error("User account is suspended");
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error("Invalid email or password");
    }

    // Retrieve active organization memberships
    const orgsRes = await client.query(
      `SELECT o.id, o.name, o.slug, m.role
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.is_active = true
       ORDER BY o.created_at ASC`,
      [user.id],
    );

    const organizations = orgsRes.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      role: row.role as TenantRole,
    }));

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
  } finally {
    client.release();
  }
}

/**
 * Provisions a new tenant organization and appoints the creator as OWNER.
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

    // Create organization
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

    // Assign creating user as OWNER
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
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
 * Switches the active tenant context for a multi-org user.
 * Validates that the user is an active member of the target organization before issuing the new token.
 */
export async function switchOrganization(params: {
  userId: string;
  targetOrganizationId: string;
  email: string;
}): Promise<string> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT role, is_active
       FROM organization_memberships
       WHERE user_id = $1 AND organization_id = $2`,
      [params.userId, params.targetOrganizationId],
    );

    if (res.rows.length === 0) {
      throw new Error("User does not have access to this organization");
    }

    const membership = res.rows[0];
    if (!membership.is_active) {
      throw new Error("Membership in this organization is deactivated");
    }

    return await issueTenantToken({
      userId: params.userId,
      organizationId: params.targetOrganizationId,
      role: membership.role as TenantRole,
      email: params.email,
    });
  } finally {
    client.release();
  }
}
