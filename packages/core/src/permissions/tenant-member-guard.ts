import { pool } from "@business-os/database";
import type { TenantContext, TenantRole } from "@business-os/types";
import type { TransactionClient } from "../crm/audit-helper.js";

export class CrossTenantAssignmentError extends Error {
  constructor(userId: string, organizationId: string) {
    super(
      `Cannot assign: User '${userId}' is not an active member of organization '${organizationId}'`,
    );
    this.name = "CrossTenantAssignmentError";
  }
}

export interface ActiveTenantMember {
  id: string;
  userId: string;
  fullName: string;
  role: TenantRole;
}

/**
 * Asserts that a user belongs to the current tenant organization and is active.
 * Throws CrossTenantAssignmentError if the user belongs to another tenant or is inactive.
 */
export async function assertActiveTenantMember(
  context: TenantContext,
  targetUserId: string,
  allowedRoles?: TenantRole[],
  customClient?: TransactionClient,
): Promise<ActiveTenantMember> {
  const client = customClient || (await pool.connect());
  const shouldRelease =
    !customClient &&
    "release" in client &&
    typeof (client as any).release === "function";

  try {
    const res = await client.query(
      `SELECT m.id, m.user_id, u.full_name, m.role, m.is_active
       FROM organization_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.user_id = $2 AND m.is_active = true`,
      [context.organizationId, targetUserId],
    );

    if (res.rows.length === 0) {
      throw new CrossTenantAssignmentError(
        targetUserId,
        context.organizationId,
      );
    }

    const member = res.rows[0];

    if (
      allowedRoles &&
      allowedRoles.length > 0 &&
      !allowedRoles.includes(member.role)
    ) {
      throw new Error(
        `User '${targetUserId}' with role '${member.role}' is not eligible for assignment. Required: ${allowedRoles.join(", ")}`,
      );
    }

    return {
      id: member.id,
      userId: member.user_id,
      fullName: member.full_name,
      role: member.role,
    };
  } finally {
    if (shouldRelease) {
      (client as any).release();
    }
  }
}
