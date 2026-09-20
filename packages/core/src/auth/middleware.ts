import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext, TenantRole } from "@business-os/types";
import { verifyTenantToken } from "./jwt.js";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Resolves and cryptographically asserts tenant context from a token.
 *
 * The token supplies the requested organization ID, but NOT authoritative role
 * state. The current role/membership is always reloaded from PostgreSQL.
 *
 * Since organizationId is known after JWT verification, membership validation
 * is performed through normal tenant RLS, not through the global bootstrap
 * router.
 */
export async function resolveTenantContextFromToken(
  token: string | undefined,
  correlationId?: string,
): Promise<TenantContext> {
  if (!token) {
    throw new AuthenticationError("Missing authentication token");
  }

  const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;

  let payload;
  try {
    payload = await verifyTenantToken(cleanToken);
  } catch {
    throw new AuthenticationError("Invalid or expired authentication token");
  }

  const state = await withTenantContext(
    payload.organizationId,
    async (client) => {
      const res = await client.query<{
        role: TenantRole;
        membership_active: boolean;
        user_active: boolean;
      }>(
        `SELECT
           m.role,
           m.is_active AS membership_active,
           u.is_active AS user_active
         FROM organization_memberships AS m
         JOIN users AS u
           ON u.id = m.user_id
         WHERE m.user_id = $1
           AND m.organization_id = $2`,
        [payload.userId, payload.organizationId],
      );

      const row = res.rows[0];
      if (!row) {
        throw new AuthorizationError(
          "User does not belong to the requested organization",
        );
      }

      return row;
    },
  );

  if (!state.user_active) {
    throw new AuthenticationError("User account is suspended");
  }

  if (!state.membership_active) {
    throw new AuthorizationError(
      "Access to this organization has been revoked",
    );
  }

  return {
    organizationId: payload.organizationId,
    userId: payload.userId,
    role: state.role,
    correlationId: correlationId || crypto.randomUUID(),
  };
}
