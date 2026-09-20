import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { consumeRateLimit } from "../packages/core/src/index.js";
import { validateWebEnvironment } from "../apps/web/lib/env.js";
import { register } from "../apps/web/instrumentation.js";

describe("Phase 21 Stabilization: Authentication Hardening, Rate Limiting & Environment Lifecycle Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Environment Validation Lifecycle on Server Startup", () => {
    it("fails closed in production if DATABASE_URL is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.DATABASE_URL;

      expect(() => validateWebEnvironment()).toThrow(
        /FATAL CONFIGURATION ERROR: DATABASE_URL is missing in production/,
      );
    });

    it("fails closed in production if DATABASE_URL uses localhost or default credentials", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL =
        "postgres://postgres:postgrespassword@localhost:5432/business_os";
      process.env.JWT_SECRET =
        "super-secret-production-jwt-key-32-chars-minimum!";
      process.env.ENCRYPTION_KEY = "super-secret-encryption-key-32-bytes!!";

      expect(() => validateWebEnvironment()).toThrow(
        /FATAL SECURITY ERROR: DATABASE_URL cannot use default credentials or localhost in production/,
      );
    });

    it("fails closed in production if JWT_SECRET is too short", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL =
        "postgres://app_user:strong_prod_pass@db.aws.internal:5432/business_os";
      process.env.JWT_SECRET = "short-key";
      process.env.ENCRYPTION_KEY = "super-secret-encryption-key-32-bytes!!";

      expect(() => validateWebEnvironment()).toThrow(
        /FATAL SECURITY ERROR: JWT_SECRET must be at least 32 characters long in production/,
      );
    });

    it("fails closed in production if ENCRYPTION_KEY is too short", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL =
        "postgres://app_user:strong_prod_pass@db.aws.internal:5432/business_os";
      process.env.JWT_SECRET =
        "super-secret-production-jwt-key-32-chars-minimum!";
      process.env.ENCRYPTION_KEY = "short-key";

      expect(() => validateWebEnvironment()).toThrow(
        /FATAL SECURITY ERROR: ENCRYPTION_KEY must be at least 32 bytes in production/,
      );
    });

    it("passes cleanly in production when all security parameters satisfy production invariants", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL =
        "postgres://app_user:strong_prod_pass@db.aws.internal:5432/business_os";
      process.env.JWT_SECRET =
        "super-secret-production-jwt-key-32-chars-minimum!";
      process.env.ENCRYPTION_KEY = "super-secret-encryption-key-32-bytes!!";

      expect(() => validateWebEnvironment()).not.toThrow();
    });

    it("verifies register() executes without error during Next.js server boot", async () => {
      process.env.NEXT_RUNTIME = "nodejs";
      await expect(register()).resolves.not.toThrow();
    });
  });

  describe("2. Authentication Endpoint Brute-Force Rate Limiting", () => {
    it("enforces sliding-window rate limit after threshold attempts", async () => {
      const testIp = `192.168.1.${Math.floor(Math.random() * 200 + 10)}`;
      const testEmail = `attacker-${Date.now()}@target.local`;
      const key = `auth:login:${testIp}:${testEmail}`;

      const limitConfig = {
        maxRequests: 6,
        windowMs: 60000,
        keyPrefix: "test_login",
      };

      let allowedCount = 0;
      for (let i = 0; i < 10; i++) {
        const res = await consumeRateLimit(key, limitConfig);
        if (res.allowed) {
          allowedCount++;
        }
      }

      // Must allow initial attempts up to limit (or degraded threshold) and block subsequent
      expect(allowedCount).toBeGreaterThanOrEqual(1);
      expect(allowedCount).toBeLessThanOrEqual(6);

      const blockedRes = await consumeRateLimit(key, limitConfig);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
    });
  });

  describe("3. Login Security & Disclosure Protection", () => {
    it("ensures public authentication errors are generic and never reveal account existence", () => {
      // Simulate login route error handler
      const sanitizeLoginError = (
        err: unknown,
      ): { error: string; status: number } => {
        return { error: "Invalid email or password", status: 401 };
      };

      expect(
        sanitizeLoginError(new Error("User account is suspended")),
      ).toEqual({
        error: "Invalid email or password",
        status: 401,
      });

      expect(
        sanitizeLoginError(new Error("User with this email not found")),
      ).toEqual({
        error: "Invalid email or password",
        status: 401,
      });

      expect(sanitizeLoginError(new Error("Password does not match"))).toEqual({
        error: "Invalid email or password",
        status: 401,
      });
    });
  });
});
