import { pool, withTenantContext } from '@business-os/database';
import { logger } from '@business-os/logger';
import type { TenantContext, TenantRole } from '@business-os/types';
import { assertPermission } from './checker.js';
import { hashPassword } from '../auth/password.js';

export interface InviteMemberInput {
  email: string;
  role: TenantRole;
  fullName: string;
}

/**
 * Invites a user to the organization with a designated role.
 * Enforces that only authorized users (OWNER, ADMIN) can invite new members.
 */
export async function inviteMember(
  context: TenantContext,
  input: InviteMemberInput
) {
  assertPermission(context, 'create', 'member');

  const emailNormalized = input.email.trim().toLowerCase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Find or create the user account
    let userId: string;
    const userRes = await client.query('SELECT id FROM users WHERE email = $1', [emailNormalized]);

    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
    } else {
      // Create user with a generated secure initial password hash
      const initialHash = await hashPassword('ChangeMe123!' + Math.random().toString());
      const newUserRes = await client.query(
        `INSERT INTO users (email, full_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [emailNormalized, input.fullName.trim(), initialHash]
      );
      userId = newUserRes.rows[0].id;
    }

    // 2. Check if already a member of this organization
    const existingMembership = await client.query(
      `SELECT id, is_active FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [context.organizationId, userId]
    );

    if (existingMembership.rows.length > 0) {
      if (existingMembership.rows[0].is_active) {
        throw new Error('User is already an active member of this organization');
      }
      // Reactivate existing membership with the new role
      await client.query(
        `UPDATE organization_memberships
         SET is_active = true, role = $1
         WHERE id = $2`,
        [input.role, existingMembership.rows[0].id]
      );
    } else {
      // Create new membership record
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
         VALUES ($1, $2, $3, true)`,
        [context.organizationId, userId, input.role]
      );
    }

    await client.query('COMMIT');

    logger.info(
      { organizationId: context.organizationId, userId, role: input.role },
      'Successfully added member to organization'
    );

    return { userId, email: emailNormalized, role: input.role };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates a member's role within the organization.
 * Prevents demoting the organization's sole remaining OWNER.
 */
export async function updateMemberRole(
  context: TenantContext,
  targetUserId: string,
  newRole: TenantRole
) {
  assertPermission(context, 'update', 'member');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check current role of target user
    const currentRes = await client.query(
      `SELECT role FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2 AND is_active = true`,
      [context.organizationId, targetUserId]
    );

    if (currentRes.rows.length === 0) {
      throw new Error('Member not found in this organization');
    }

    const currentRole = currentRes.rows[0].role;

    // 2. If target is an OWNER and role is changing, ensure they are not the only OWNER
    if (currentRole === 'OWNER' && newRole !== 'OWNER') {
      const ownerCountRes = await client.query(
        `SELECT COUNT(*) as count FROM organization_memberships
         WHERE organization_id = $1 AND role = 'OWNER' AND is_active = true`,
        [context.organizationId]
      );

      const ownerCount = parseInt(ownerCountRes.rows[0].count, 10);
      if (ownerCount <= 1) {
        throw new Error('Cannot demote the last OWNER of an organization');
      }
    }

    await client.query(
      `UPDATE organization_memberships
       SET role = $1
       WHERE organization_id = $2 AND user_id = $3`,
      [newRole, context.organizationId, targetUserId]
    );

    await client.query('COMMIT');

    logger.info(
      { organizationId: context.organizationId, targetUserId, newRole },
      'Successfully updated member role'
    );

    return { targetUserId, newRole };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deactivates a member's access to the organization.
 * Prevents removing the last remaining OWNER.
 */
export async function removeMember(
  context: TenantContext,
  targetUserId: string
) {
  assertPermission(context, 'delete', 'member');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT role FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2 AND is_active = true`,
      [context.organizationId, targetUserId]
    );

    if (currentRes.rows.length === 0) {
      throw new Error('Member not found in this organization');
    }

    if (currentRes.rows[0].role === 'OWNER') {
      const ownerCountRes = await client.query(
        `SELECT COUNT(*) as count FROM organization_memberships
         WHERE organization_id = $1 AND role = 'OWNER' AND is_active = true`,
        [context.organizationId]
      );

      const ownerCount = parseInt(ownerCountRes.rows[0].count, 10);
      if (ownerCount <= 1) {
        throw new Error('Cannot remove the last OWNER of an organization');
      }
    }

    await client.query(
      `UPDATE organization_memberships
       SET is_active = false
       WHERE organization_id = $1 AND user_id = $2`,
      [context.organizationId, targetUserId]
    );

    await client.query('COMMIT');

    logger.info(
      { organizationId: context.organizationId, targetUserId },
      'Successfully removed member from organization'
    );

    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lists all members of the organization.
 */
export async function listOrganizationMembers(context: TenantContext) {
  assertPermission(context, 'read', 'member');

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT m.id, m.user_id, u.email, u.full_name, m.role, m.is_active, m.created_at
       FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [context.organizationId]
    );

    return res.rows;
  } finally {
    client.release();
  }
}
