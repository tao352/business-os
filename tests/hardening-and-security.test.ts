import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import {
  consumeRateLimit,
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
} from "../packages/core/src/security/index.js";
import {
  withTenantCache,
  getTenantCache,
  setTenantCache,
  deleteTenantCache,
  invalidateTenantCache,
  clearAllTenantCaches,
  buildTenantCacheKey,
} from "../packages/core/src/cache/index.js";

describe("Phase 20: Hardening, Scaling, Rate Limiting & Security Fuzzing", () => {
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();

  const contextA: TenantContext = {
    userId: crypto.randomUUID(),
    organizationId: orgAId,
    role: "ADMIN",
    permissions: ["*"],
  };

  const contextB: TenantContext = {
    userId: crypto.randomUUID(),
    organizationId: orgBId,
    role: "ADMIN",
    permissions: ["*"],
  };

  beforeEach(async () => {
    await clearAllRateLimits();
    await clearAllTenantCaches();
  });

  describe("1. Distributed Rate Limiter", () => {
    it("should allow requests within limit and block upon exceeding quota", async () => {
      const key = `test_user_${crypto.randomBytes(4).toString("hex")}`;
      const config = { windowMs: 1000, maxRequests: 3, keyPrefix: "rl:test" };

      // 1st request
      const r1 = await consumeRateLimit(key, config);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
      expect(r1.current).toBe(1);

      // 2nd request
      const r2 = await consumeRateLimit(key, config);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);
      expect(r2.current).toBe(2);

      // 3rd request (hits ceiling)
      const r3 = await consumeRateLimit(key, config);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
      expect(r3.current).toBe(3);

      // 4th request (blocked)
      const r4 = await consumeRateLimit(key, config);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.limit).toBe(3);
    });

    it("should check status without consuming tokens", async () => {
      const key = `ip_check_${crypto.randomBytes(4).toString("hex")}`;
      const config = { windowMs: 2000, maxRequests: 5, keyPrefix: "rl:ip" };

      await consumeRateLimit(key, config);
      await consumeRateLimit(key, config);

      const check = await checkRateLimit(key, config);
      expect(check.allowed).toBe(true);
      expect(check.current).toBe(2);
      expect(check.remaining).toBe(3);

      // Ensure check didn't consume a token
      const checkAgain = await checkRateLimit(key, config);
      expect(checkAgain.current).toBe(2);
    });

    it("should isolate rate limits across distinct IP addresses and tenants", async () => {
      const ip1 = "192.168.1.50";
      const ip2 = "10.0.0.12";
      const config = { windowMs: 2000, maxRequests: 2, keyPrefix: "rl:ip" };

      // Exhaust IP 1
      await consumeRateLimit(ip1, config);
      await consumeRateLimit(ip1, config);
      const ip1Blocked = await consumeRateLimit(ip1, config);
      expect(ip1Blocked.allowed).toBe(false);

      // IP 2 must still have full quota
      const ip2Allowed = await consumeRateLimit(ip2, config);
      expect(ip2Allowed.allowed).toBe(true);
      expect(ip2Allowed.remaining).toBe(1);

      // Tenant AI quotas isolation
      const tenantKey1 = `tenant:${orgAId}:ai_tokens`;
      const tenantKey2 = `tenant:${orgBId}:ai_tokens`;
      const tenantConfig = {
        windowMs: 3000,
        maxRequests: 1,
        keyPrefix: "rl:ai",
      };

      await consumeRateLimit(tenantKey1, tenantConfig);
      const tenant1Blocked = await consumeRateLimit(tenantKey1, tenantConfig);
      expect(tenant1Blocked.allowed).toBe(false);

      const tenant2Allowed = await consumeRateLimit(tenantKey2, tenantConfig);
      expect(tenant2Allowed.allowed).toBe(true);
    });

    it("should reset rate limit when requested", async () => {
      const key = `reset_target_${crypto.randomBytes(4).toString("hex")}`;
      const config = { windowMs: 5000, maxRequests: 1, keyPrefix: "rl:reset" };

      await consumeRateLimit(key, config);
      const blocked = await consumeRateLimit(key, config);
      expect(blocked.allowed).toBe(false);

      await resetRateLimit(key, config.keyPrefix);

      const allowedAfterReset = await consumeRateLimit(key, config);
      expect(allowedAfterReset.allowed).toBe(true);
    });

    it("should allow requests again after window expiry", async () => {
      const key = `expire_target_${crypto.randomBytes(4).toString("hex")}`;
      const config = { windowMs: 80, maxRequests: 1, keyPrefix: "rl:exp" };

      await consumeRateLimit(key, config);
      const blocked = await consumeRateLimit(key, config);
      expect(blocked.allowed).toBe(false);

      // Wait for window to slide past
      await new Promise((resolve) => setTimeout(resolve, 100));

      const allowedAfterExpiry = await consumeRateLimit(key, config);
      expect(allowedAfterExpiry.allowed).toBe(true);
    });
  });

  describe("2. Keyspace-Isolated Multi-Tenant Caching (Invariant 3.1)", () => {
    it("should perform cache-aside read, return cached value on hit, and avoid re-fetching", async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { reportTitle: "Taj City Q3 Sales", totalDeals: 42 };
      };

      // 1st call: Cache miss
      const res1 = await withTenantCache(contextA, "q3_report", 60, fetcher);
      expect(res1.reportTitle).toBe("Taj City Q3 Sales");
      expect(callCount).toBe(1);

      // 2nd call: Cache hit
      const res2 = await withTenantCache(contextA, "q3_report", 60, fetcher);
      expect(res2.reportTitle).toBe("Taj City Q3 Sales");
      expect(callCount).toBe(1); // Fetcher NOT called again
    });

    it("should strictly isolate cached data between organizations (ZERO LEAK TOLERANCE)", async () => {
      // Organization A caches sensitive financial metrics
      await setTenantCache(
        contextA,
        "executive_kpis",
        { revenue: 18500000, confidentialMargin: "34%" },
        60,
      );

      // Organization B attempts to read the same key
      const orgBCached = await getTenantCache(contextB, "executive_kpis");
      expect(orgBCached).toBeNull(); // Org B CANNOT read Org A's cached metrics!

      // Organization B writes its own distinct data
      await setTenantCache(
        contextB,
        "executive_kpis",
        { revenue: 3200000, confidentialMargin: "15%" },
        60,
      );

      // Verify each tenant receives only their own data
      const aData = await getTenantCache<{ revenue: number }>(
        contextA,
        "executive_kpis",
      );
      const bData = await getTenantCache<{ revenue: number }>(
        contextB,
        "executive_kpis",
      );

      expect(aData?.revenue).toBe(18500000);
      expect(bData?.revenue).toBe(3200000);
    });

    it("should isolate caches across namespaces within the same tenant", async () => {
      await setTenantCache(
        contextA,
        "profile",
        { name: "User Profile" },
        60,
        "users",
      );
      await setTenantCache(
        contextA,
        "profile",
        { name: "Billing Profile" },
        60,
        "billing",
      );

      const userProfile = await getTenantCache<{ name: string }>(
        contextA,
        "profile",
        "users",
      );
      const billingProfile = await getTenantCache<{ name: string }>(
        contextA,
        "profile",
        "billing",
      );

      expect(userProfile?.name).toBe("User Profile");
      expect(billingProfile?.name).toBe("Billing Profile");
    });

    it("should delete specific keys without affecting other keys or tenants", async () => {
      await setTenantCache(contextA, "key1", "val1", 60);
      await setTenantCache(contextA, "key2", "val2", 60);
      await setTenantCache(contextB, "key1", "val_b", 60);

      const deleted = await deleteTenantCache(contextA, "key1");
      expect(deleted).toBe(true);

      // Key1 is gone for Org A
      expect(await getTenantCache(contextA, "key1")).toBeNull();
      // Key2 is still intact for Org A
      expect(await getTenantCache(contextA, "key2")).toBe("val2");
      // Key1 for Org B remains completely untouched
      expect(await getTenantCache(contextB, "key1")).toBe("val_b");
    });

    it("should scope wildcard cache invalidation strictly to the calling tenant", async () => {
      // Setup Org A keys
      await setTenantCache(contextA, "unit:101", { no: "101" }, 60);
      await setTenantCache(contextA, "unit:102", { no: "102" }, 60);
      await setTenantCache(contextA, "lead:500", { name: "Lead" }, 60);

      // Setup Org B keys (matching pattern)
      await setTenantCache(contextB, "unit:101", { no: "101_b" }, 60);
      await setTenantCache(contextB, "unit:999", { no: "999_b" }, 60);

      // Invalidate all units for Org A
      const invalidatedCount = await invalidateTenantCache(contextA, "unit:*");
      expect(invalidatedCount).toBe(2);

      // Org A units must be cleared
      expect(await getTenantCache(contextA, "unit:101")).toBeNull();
      expect(await getTenantCache(contextA, "unit:102")).toBeNull();
      // Org A leads must still exist
      expect(await getTenantCache(contextA, "lead:500")).not.toBeNull();

      // Org B units must remain completely untouched
      const orgBUnit101 = await getTenantCache<{ no: string }>(
        contextB,
        "unit:101",
      );
      const orgBUnit999 = await getTenantCache<{ no: string }>(
        contextB,
        "unit:999",
      );
      expect(orgBUnit101?.no).toBe("101_b");
      expect(orgBUnit999?.no).toBe("999_b");
    });
  });

  describe("3. Security Fuzzing & High Concurrency Isolation", () => {
    it("should reject invalid tenant IDs and sanitize key structures", () => {
      expect(() => buildTenantCacheKey("", "some_key")).toThrow(
        "Cannot build tenant cache key without valid organizationId",
      );

      // Malicious attempt to inject path traversal or wildcard into key
      const maliciousKey = "../../other_tenant/*";
      const sanitizedKey = buildTenantCacheKey(orgAId, maliciousKey);
      // Key is strictly scoped within orgA prefix
      expect(sanitizedKey).toBe(`tenant:${orgAId}:default:${maliciousKey}`);
      expect(sanitizedKey.startsWith(`tenant:${orgAId}:`)).toBe(true);
    });

    it("should maintain zero data leakage under high-concurrency multi-tenant operations", async () => {
      const tenants = Array.from({ length: 10 }, (_, i) => ({
        context: {
          userId: crypto.randomUUID(),
          organizationId: `org_concurrent_${i}_${crypto.randomBytes(3).toString("hex")}`,
          role: "ADMIN",
          permissions: ["*"],
        } as TenantContext,
        uniqueSecret: `tenant_secret_${i}_${crypto.randomBytes(6).toString("hex")}`,
      }));

      // Concurrent writes from 10 distinct tenants
      await Promise.all(
        tenants.map(async (t) => {
          await setTenantCache(
            t.context,
            "vault_secret",
            { secret: t.uniqueSecret },
            60,
          );
        }),
      );

      // Concurrent reads verifying 100% tenant isolation
      const readResults = await Promise.all(
        tenants.map(async (t) => {
          const cached = await getTenantCache<{ secret: string }>(
            t.context,
            "vault_secret",
          );
          return {
            expected: t.uniqueSecret,
            actual: cached?.secret,
            match: cached?.secret === t.uniqueSecret,
          };
        }),
      );

      for (const result of readResults) {
        expect(result.match).toBe(true);
        expect(result.actual).toBe(result.expected);
      }
    });
  });
});
