import type { TenantContext, TenantRole } from "@business-os/types";
import { can } from "./checker.js";

export interface UiCapabilities {
  canCreateLead: boolean;
  canExportLeads: boolean;
  canUpdateAllLeads: boolean;
  canReadProjects: boolean;
  canCreateProject: boolean;
  canUpdateProject: boolean;
  canReadUnits: boolean;
  canCreateUnit: boolean;
  canUpdateUnit: boolean;
  canReserveUnit: boolean;
  canReadAutomations: boolean;
  canReadIntegrations: boolean;
  canReadSettings: boolean;
}

/**
 * Resolves authoritative UI capability flags for an authenticated context or session.
 * Replaces client-side role guesswork with strict matrix-backed authorization checks.
 */
export function getUiCapabilities(
  context:
    | TenantContext
    | {
        role: TenantRole;
        userId?: string;
        organizationId?: string;
      },
): UiCapabilities {
  const ctx: TenantContext = {
    organizationId:
      context.organizationId || "00000000-0000-0000-0000-000000000000",
    userId: context.userId || "00000000-0000-0000-0000-000000000000",
    role: context.role,
    correlationId: "ui-capabilities",
  };

  return {
    canCreateLead: can(ctx, "create", "lead"),
    canExportLeads: can(ctx, "export", "lead"),
    canUpdateAllLeads: can(ctx, "update_all", "lead"),
    canReadProjects: can(ctx, "read", "project"),
    canCreateProject: can(ctx, "create", "project"),
    canUpdateProject: can(ctx, "update", "project"),
    canReadUnits: can(ctx, "read", "unit"),
    canCreateUnit: can(ctx, "create", "unit"),
    canUpdateUnit: can(ctx, "update", "unit"),
    canReserveUnit: can(ctx, "create", "reservation"),
    canReadAutomations: can(ctx, "read", "smart_rule"),
    canReadIntegrations:
      can(ctx, "manage", "organization") ||
      (can(ctx, "read", "organization") &&
        (context.role === "OWNER" || context.role === "ADMIN")),
    canReadSettings:
      can(ctx, "update", "organization") ||
      context.role === "OWNER" ||
      context.role === "ADMIN",
  };
}
