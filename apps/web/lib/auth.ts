import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@business-os/database";
import type { TenantContext, TenantRole } from "@business-os/types";
import {
  resolveTenantContextFromToken,
  verifyTenantToken,
  AuthenticationError,
  AuthorizationError,
} from "@business-os/core";

export const SESSION_COOKIE_NAME = "business_os_session";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: TenantRole;
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: TenantRole;
  }>;
}

/**
 * Centrally validates the secure session cookie, asserts tenant membership in DB,
 * and returns the authoritative TenantContext. Redirects to /login if unauthenticated.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/login");
  }

  try {
    return await resolveTenantContextFromToken(token);
  } catch (err) {
    if (
      err instanceof AuthenticationError ||
      err instanceof AuthorizationError
    ) {
      redirect("/login");
    }
    throw err;
  }
}

/**
 * Retrieves the currently authenticated user and active organization details.
 * Returns null if not authenticated or membership is revoked.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = await verifyTenantToken(token);
    const client = await pool.connect();
    try {
      // 1. Fetch user details and active status
      const userRes = await client.query(
        `SELECT id, email, full_name, is_active FROM users WHERE id = $1`,
        [payload.userId],
      );
      if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
        return null;
      }
      const user = userRes.rows[0];

      // 2. Fetch all active organization memberships
      const orgsRes = await client.query(
        `SELECT o.id, o.name, o.slug, m.role
         FROM organization_memberships m
         JOIN organizations o ON o.id = m.organization_id
         WHERE m.user_id = $1 AND m.is_active = true
         ORDER BY o.name ASC`,
        [user.id],
      );

      if (orgsRes.rows.length === 0) {
        return null;
      }

      const activeOrg = orgsRes.rows.find(
        (o) => o.id === payload.organizationId,
      );
      if (!activeOrg) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: activeOrg.role as TenantRole,
        activeOrganization: {
          id: activeOrg.id,
          name: activeOrg.name,
          slug: activeOrg.slug,
        },
        organizations: orgsRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          role: row.role as TenantRole,
        })),
      };
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

/**
 * Sets the secure session cookie with production-grade flags.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

/**
 * Clears the session cookie on logout.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
