import type { TenantRole } from "@business-os/types";

export type Resource =
  | "organization"
  | "user"
  | "member"
  | "lead"
  | "unit"
  | "project"
  | "campaign"
  | "contract"
  | "reservation"
  | "smart_rule"
  | "custom_field"
  | "audit_log"
  | "report";

export type Action =
  | "create"
  | "read"
  | "read_all"
  | "update"
  | "update_all"
  | "delete"
  | "export"
  | "manage";

export interface PermissionRule {
  role: TenantRole;
  resource: Resource;
  actions: Action[];
}

export class ForbiddenError extends Error {
  public readonly code = "FORBIDDEN";
  public readonly role: TenantRole;
  public readonly action: Action;
  public readonly resource: Resource;

  constructor(
    role: TenantRole,
    action: Action,
    resource: Resource,
    message?: string,
  ) {
    super(
      message ||
        `Role '${role}' is not authorized to perform '${action}' on '${resource}'`,
    );
    this.name = "ForbiddenError";
    this.role = role;
    this.action = action;
    this.resource = resource;
  }
}
