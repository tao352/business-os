import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { withTenantContext } from "@business-os/database";
import type { TenantContext } from "@business-os/types";
import {
  createLead,
  createOrganization,
  registerUser,
} from "../packages/core/src/index.js";

describe("R1 Lead status database guard", () => {
  it("rejects a non-canonical Lead status even through direct SQL", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const owner = await registerUser({
      email: `r1.db.status.${suffix}@example.test`,
      password: "StrongPassword123!",
      fullName: "R1 DB Status Owner",
    });
    const organization = await createOrganization({
      userId: owner.id,
      name: `R1 DB Status Org ${suffix}`,
      slug: `r1-db-status-${suffix}`,
    });
    const context: TenantContext = {
      organizationId: organization.id,
      userId: owner.id,
      role: "OWNER",
      correlationId: `r1-db-status-${suffix}`,
    };

    const lead = await createLead(context, {
      fullName: "Database Guard Lead",
      phone: `558${suffix}`,
    });

    await expect(
      withTenantContext(context.organizationId, async (tx) => {
        await tx.query(
          "UPDATE leads SET status = 'ESCALATED' WHERE id = $1",
          [lead.id],
        );
      }),
    ).rejects.toThrow();

    const persistedStatus = await withTenantContext(
      context.organizationId,
      async (tx) => {
        const res = await tx.query(
          "SELECT status FROM leads WHERE id = $1",
          [lead.id],
        );
        return res.rows[0]?.status;
      },
    );

    expect(persistedStatus).toBe("NEW");
  });
});
