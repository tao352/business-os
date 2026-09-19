import type { TenantRole, TenantContext } from "@business-os/types";
import type { Resource, Action } from "./types.js";
import { ROLE_PERMISSIONS } from "./matrix.js";
import { ForbiddenError } from "./types.js";

/**
 * Checks whether a role has static permission to execute an action on a resource.
 */
export function hasRolePermission(
  role: TenantRole,
  action: Action,
  resource: Resource,
): boolean {
  const resourcePermissions = ROLE_PERMISSIONS[role]?.[resource];
  if (!resourcePermissions) {
    return false;
  }
  return resourcePermissions.includes(action);
}

/**
 * Evaluates whether an authenticated tenant user is permitted to perform an action.
 * Handles row-level ownership constraints (e.g. Salespersons can only access their assigned leads).
 */
export function can(
  context: TenantContext,
  action: Action,
  resource: Resource,
  targetEntity?: Record<string, unknown>,
): boolean {
  const { role, userId } = context;

  // 1. Basic role permission check
  if (!hasRolePermission(role, action, resource)) {
    return false;
  }

  // 2. Row-level ownership constraints for SALESPERSON
  if (role === "SALESPERSON") {
    if (resource === "lead") {
      // Salesperson cannot execute bulk actions
      if (
        action === "read_all" ||
        action === "update_all" ||
        action === "export" ||
        action === "delete"
      ) {
        return false;
      }
      // If a specific lead record is provided, verify it is assigned to this user
      if (targetEntity && targetEntity.assigned_user_id !== userId) {
        return false;
      }
    }

    if (resource === "reservation" && targetEntity) {
      if (
        targetEntity.assigned_user_id &&
        targetEntity.assigned_user_id !== userId
      ) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Asserts permission and throws a typed ForbiddenError if authorization fails.
 */
export function assertPermission(
  context: TenantContext,
  action: Action,
  resource: Resource,
  targetEntity?: Record<string, unknown>,
): void {
  if (!can(context, action, resource, targetEntity)) {
    throw new ForbiddenError(context.role, action, resource);
  }
}
