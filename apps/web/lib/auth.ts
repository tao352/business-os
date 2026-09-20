import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@business-os/database";
import type { TenantContext, TenantRole } from "@business-os/types";
import {
  resolveTenantContextFromToken,
  verifyTenantToken,
  listActiveOrganizationsForUser,
  AuthenticationError,
  AuthorizationError,
  getUiCapabilities,
  type UiCapabilities,
} from "@business-os/core";

export const SESSION_COOKIE_NAME = "business_os_session";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: TenantRole;
  capabilities: UiCapabilities;
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
 * Returns the signed-in user and the organizations available to the switcher.
 *
 * Important:
 * - active tenant membership is revalidated via normal RLS
 * - the multi-org list uses only the narrow pre-tenant bootstrap router
 * - no direct unscoped organization_memberships SELECT remains here
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    const payload = await verifyTenantToken(token);
    const context = await resolveTenantContextFromToken(token);

    const userRes = await pool.query<{
      id: string;
      email: string;
      full_name: string;
      is_active: boolean;
    }>(
      `SELECT id, email, full_name, is_active
       FROM users
       WHERE id = $1`,
      [context.userId],
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      return null;
    }

    const user = userRes.rows[0];
    const organizations = await listActiveOrganizationsForUser(context.userId);

    if (organizations.length === 0) {
      return null;
    }

    const activeOrg = organizations.find(
      (organization) => organization.id === context.organizationId,
    );

    if (!activeOrg) {
      return null;
    }

    const capabilities = getUiCapabilities({
      organizationId: context.organizationId,
      userId: context.userId,
      role: context.role,
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: context.role,
      capabilities,
      activeOrganization: {
        id: activeOrg.id,
        name: activeOrg.name,
        slug: activeOrg.slug,
      },
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
      })),
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
