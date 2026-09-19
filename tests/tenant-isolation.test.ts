import { describe, it, expect, vi } from "vitest";
import { withTenantContext } from "../packages/database/src/tenant-context.js";
import { pool } from "../packages/database/src/client.js";

describe("Multi-Tenant Isolation Context", () => {
  it("throws an error if organizationId is missing or empty", async () => {
    await expect(withTenantContext("", async () => "result")).rejects.toThrow(
      "withTenantContext requires a valid non-empty organizationId",
    );
  });

  it("sets the local transaction setting and executes the callback", async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: vi
        .fn()
        .mockImplementation(async (sql: string, params?: unknown[]) => {
          executedQueries.push(params ? `${sql} [${params.join(", ")}]` : sql);
          return { rows: [] };
        }),
      release: vi.fn(),
    };

    vi.spyOn(pool, "connect").mockResolvedValue(mockClient as any);

    const testOrgId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    const result = await withTenantContext(testOrgId, async (client) => {
      await client.query("SELECT * FROM leads");
      return "success";
    });

    expect(result).toBe("success");
    expect(executedQueries).toEqual([
      "BEGIN",
      "SET LOCAL ROLE app_user",
      `SELECT set_config('app.current_tenant_id', $1, true) [${testOrgId}]`,
      "SELECT * FROM leads",
      "COMMIT",
    ]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back the transaction if an operation fails inside the context", async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: vi
        .fn()
        .mockImplementation(async (sql: string, params?: unknown[]) => {
          executedQueries.push(params ? `${sql} [${params.join(", ")}]` : sql);
          return { rows: [] };
        }),
      release: vi.fn(),
    };

    vi.spyOn(pool, "connect").mockResolvedValue(mockClient as any);

    const testOrgId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    await expect(
      withTenantContext(testOrgId, async () => {
        throw new Error("Database constraint violation");
      }),
    ).rejects.toThrow("Database constraint violation");

    expect(executedQueries).toContain("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
