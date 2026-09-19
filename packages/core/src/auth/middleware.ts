import crypto from 'node:crypto';
import { pool } from '@business-os/database';
import type { TenantContext } from '@business-os/types';
import { verifyTenantToken } from './jwt.js';

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Resolves and cryptographically asserts the tenant context from a bearer token or cookie.
 * Ensures the user's membership and the organization itself are active in the database.
 */
export async function resolveTenantContextFromToken(
  token: string | undefined,
  correlationId?: string
): Promise<TenantContext> {
  if (!token) {
    throw new AuthenticationError('Missing authentication token');
  }

  // Clean 'Bearer ' prefix if present
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

  let payload;
  try {
    payload = await verifyTenantToken(cleanToken);
  } catch (err) {
    throw new AuthenticationError('Invalid or expired authentication token');
  }

  // Verify real-time database membership state
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT m.role, m.is_active as membership_active, u.is_active as user_active
       FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1 AND m.organization_id = $2`,
      [payload.userId, payload.organizationId]
    );

    if (res.rows.length === 0) {
      throw new AuthorizationError('User does not belong to the requested organization');
    }

    const { role, membership_active, user_active } = res.rows[0];

    if (!user_active) {
      throw new AuthenticationError('User account is suspended');
    }

    if (!membership_active) {
      throw new AuthorizationError('Access to this organization has been revoked');
    }

    return {
      organizationId: payload.organizationId,
      userId: payload.userId,
      role: role,
      correlationId: correlationId || crypto.randomUUID(),
    };
  } finally {
    client.release();
  }
}
