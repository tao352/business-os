import { describe, expect, it } from "vitest";
import { getUiCapabilities } from "../packages/core/src/index.js";
import type { TenantRole } from "@business-os/types";

function capabilitiesFor(role: TenantRole) {
  return getUiCapabilities({
    role,
    organizationId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
  });
}

describe("Phase 23B Sales Command Center capabilities", () => {
  it("allows operational sales roles to access the command center", () => {
    expect(capabilitiesFor("OWNER").canReadSalesCommandCenter).toBe(true);
    expect(capabilitiesFor("SALES_MANAGER").canReadSalesCommandCenter).toBe(
      true,
    );
    expect(capabilitiesFor("SALESPERSON").canReadSalesCommandCenter).toBe(true);
  });

  it("keeps aggregate-only marketing users out of individual lead queues", () => {
    expect(capabilitiesFor("MARKETING_USER").canReadSalesCommandCenter).toBe(
      false,
    );
  });
});
