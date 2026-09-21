import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  createOrganization,
  ForbiddenError,
  inviteMember,
  listContracts,
  registerUser,
} from "../packages/core/src/index.js";

describe("R1 Contract authorization boundary", () => {
  it("rejects contract listing for roles without contract read permission", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.contract.auth.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 Contract Auth Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 Contract Auth Org ${suffix}`,
      slug: `r1-contract-auth-${suffix}`,
    });

    const ownerContext: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-contract-auth-owner-${suffix}`,
    };

    const salesperson = await inviteMember(ownerContext, {
      email: `r1.contract.sales.${suffix}@example.test`,
      fullName: "R1 Contract Salesperson",
      role: "SALESPERSON",
    });

    const salespersonContext: TenantContext = {
      organizationId: organization.id,
      userId: salesperson.userId,
      role: "SALESPERSON",
      correlationId: `r1-contract-auth-sales-${suffix}`,
    };

    await expect(listContracts(salespersonContext)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
