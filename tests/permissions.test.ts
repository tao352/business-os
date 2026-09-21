import { describe, it, expect } from "vitest";
import type { TenantContext } from "@business-os/types";
import {
  can,
  assertPermission,
  ForbiddenError,
  hasRolePermission,
} from "../packages/core/src/index.js";

describe("RBAC Permission Engine", () => {
  const mockOrgId = "org-1111-2222-3333";
  const mockUserId = "user-agent-007";

  const makeContext = (role: any): TenantContext => ({
    organizationId: mockOrgId,
    userId: mockUserId,
    role,
    correlationId: "req-test-123",
  });

  describe("OWNER & ADMIN Roles", () => {
    it("OWNER has unrestricted permission on all resources", () => {
      const ownerCtx = makeContext("OWNER");
      expect(can(ownerCtx, "delete", "organization")).toBe(true);
      expect(can(ownerCtx, "manage", "lead")).toBe(true);
      expect(can(ownerCtx, "export", "contract")).toBe(true);
      expect(can(ownerCtx, "manage", "smart_rule")).toBe(true);
    });

    it("ADMIN has management permissions but CANNOT delete organization", () => {
      const adminCtx = makeContext("ADMIN");
      expect(can(adminCtx, "update", "organization")).toBe(true);
      expect(can(adminCtx, "manage", "custom_field")).toBe(true);
      expect(can(adminCtx, "manage", "smart_rule")).toBe(true);
      expect(can(adminCtx, "delete", "organization")).toBe(false);

      expect(() =>
        assertPermission(adminCtx, "delete", "organization"),
      ).toThrow(ForbiddenError);
    });
  });

  describe("SALES_MANAGER vs SALESPERSON Roles", () => {
    const managerCtx = makeContext("SALES_MANAGER");
    const agentCtx = makeContext("SALESPERSON");

    it("SALES_MANAGER can read and update all leads and opportunities", () => {
      expect(can(managerCtx, "read_all", "lead")).toBe(true);
      expect(can(managerCtx, "update_all", "lead")).toBe(true);
      expect(can(managerCtx, "export", "lead")).toBe(true);
      expect(can(managerCtx, "create", "opportunity")).toBe(true);
      expect(can(managerCtx, "read_all", "opportunity")).toBe(true);
      expect(can(managerCtx, "update_all", "opportunity")).toBe(true);
    });

    it("SALESPERSON cannot access bulk lead actions", () => {
      expect(can(agentCtx, "read_all", "lead")).toBe(false);
      expect(can(agentCtx, "update_all", "lead")).toBe(false);
      expect(can(agentCtx, "export", "lead")).toBe(false);
      expect(can(agentCtx, "delete", "lead")).toBe(false);
    });

    it("SALESPERSON can only view and update leads assigned to them", () => {
      const assignedLead = {
        id: "lead-1",
        assigned_user_id: mockUserId,
      };

      const unassignedLead = {
        id: "lead-2",
        assigned_user_id: "other-agent-999",
      };

      // Assigned lead: permitted
      expect(can(agentCtx, "read", "lead", assignedLead)).toBe(true);
      expect(can(agentCtx, "update", "lead", assignedLead)).toBe(true);

      // Unassigned lead: denied!
      expect(can(agentCtx, "read", "lead", unassignedLead)).toBe(false);
      expect(can(agentCtx, "update", "lead", unassignedLead)).toBe(false);

      expect(() =>
        assertPermission(agentCtx, "update", "lead", unassignedLead),
      ).toThrow(ForbiddenError);
    });

    it("SALESPERSON can only access opportunities assigned to them", () => {
      const ownOpportunity = {
        id: "opp-1",
        assigned_user_id: mockUserId,
      };
      const foreignOpportunity = {
        id: "opp-2",
        assigned_user_id: "other-agent-999",
      };

      expect(can(agentCtx, "create", "opportunity", ownOpportunity)).toBe(true);
      expect(can(agentCtx, "read", "opportunity", ownOpportunity)).toBe(true);
      expect(can(agentCtx, "update", "opportunity", ownOpportunity)).toBe(true);
      expect(can(agentCtx, "read", "opportunity", foreignOpportunity)).toBe(
        false,
      );
      expect(can(agentCtx, "update", "opportunity", foreignOpportunity)).toBe(
        false,
      );
      expect(can(agentCtx, "read_all", "opportunity")).toBe(false);
    });
  });

  describe("MARKETING & FINANCE Roles", () => {
    it("MARKETING_MANAGER can manage campaigns and export lead analytics", () => {
      const mktManagerCtx = makeContext("MARKETING_MANAGER");
      expect(can(mktManagerCtx, "manage", "campaign")).toBe(true);
      expect(can(mktManagerCtx, "export", "lead")).toBe(true);
      expect(can(mktManagerCtx, "delete", "contract")).toBe(false);
    });

    it("MARKETING_USER cannot export leads or modify campaigns", () => {
      const mktUserCtx = makeContext("MARKETING_USER");
      expect(can(mktUserCtx, "read_all", "campaign")).toBe(true);
      expect(can(mktUserCtx, "create", "campaign")).toBe(false);
      expect(can(mktUserCtx, "export", "lead")).toBe(false);
    });

    it("FINANCE can manage contracts and export financial reports", () => {
      const financeCtx = makeContext("FINANCE");
      expect(can(financeCtx, "manage", "contract")).toBe(true);
      expect(can(financeCtx, "export", "contract")).toBe(true);
      expect(can(financeCtx, "manage", "smart_rule")).toBe(false);
    });
  });

  describe("READ_ONLY Role", () => {
    it("READ_ONLY cannot create, update, or delete any resource", () => {
      const roCtx = makeContext("READ_ONLY");
      expect(can(roCtx, "read", "lead")).toBe(true);
      expect(can(roCtx, "read_all", "unit")).toBe(true);
      expect(can(roCtx, "create", "lead")).toBe(false);
      expect(can(roCtx, "update", "unit")).toBe(false);
      expect(can(roCtx, "delete", "reservation")).toBe(false);
    });
  });
});
