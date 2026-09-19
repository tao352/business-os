import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import type { TenantContext } from "@business-os/types";
import { registerUser } from "../packages/core/src/auth/auth-service.js";
import { createOrganization } from "../packages/core/src/auth/index.js";
import {
  setFeatureFlag,
  isFeatureEnabled,
  listFeatureFlags,
  createDiagnosticContext,
  sanitizeDiagnosticError,
  getSystemHealthOverview,
  recordTenantIncident,
  listTenantIncidents,
  resolveTenantIncident,
  executeSafeOpsAction,
} from "../packages/core/src/ops/index.js";

describe("Phase 17: Operations, Observability & Feature Flags", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");

  let orgAContext: TenantContext;
  let orgBContext: TenantContext;

  beforeAll(async () => {
    // 1. Setup Org A
    const ownerA = await registerUser({
      email: `ops.owner.a.${uniqueSuffix}@acme.eg`,
      password: "StrongPassword2026!",
      fullName: "Ahmed Zaki",
    });
    const orgA = await createOrganization({
      userId: ownerA.id,
      name: `Acme Real Estate ${uniqueSuffix}`,
      slug: `acme-${uniqueSuffix}`,
    });
    orgAContext = {
      userId: ownerA.id,
      organizationId: orgA.id,
      role: "OWNER",
      correlationId: `trace-org-a-${uniqueSuffix}`,
    };

    // 2. Setup Org B
    const ownerB = await registerUser({
      email: `ops.owner.b.${uniqueSuffix}@beta.eg`,
      password: "StrongPassword2026!",
      fullName: "Tarek Nour",
    });
    const orgB = await createOrganization({
      userId: ownerB.id,
      name: `Beta Properties ${uniqueSuffix}`,
      slug: `beta-${uniqueSuffix}`,
    });
    orgBContext = {
      userId: ownerB.id,
      organizationId: orgB.id,
      role: "OWNER",
      correlationId: `trace-org-b-${uniqueSuffix}`,
    };
  });

  describe("1. Feature Flags Engine (Global, Tenant Targeting & Percentage)", () => {
    it("should correctly evaluate globally enabled feature flag", async () => {
      const flagKey = `flag_global_${uniqueSuffix}`;
      await setFeatureFlag({
        key: flagKey,
        name: "Global New Feature",
        enabled_globally: true,
      });

      const enabledForA = await isFeatureEnabled(flagKey, orgAContext);
      const enabledForB = await isFeatureEnabled(flagKey, orgBContext);
      const enabledWithoutContext = await isFeatureEnabled(flagKey);

      expect(enabledForA).toBe(true);
      expect(enabledForB).toBe(true);
      expect(enabledWithoutContext).toBe(true);
    });

    it("should correctly target specific tenants and exclude others", async () => {
      const flagKey = `flag_tenant_specific_${uniqueSuffix}`;
      await setFeatureFlag({
        key: flagKey,
        name: "Tenant Targeted Feature",
        enabled_globally: false,
        target_tenants: [orgAContext.organizationId],
      });

      const enabledForA = await isFeatureEnabled(flagKey, orgAContext);
      const enabledForB = await isFeatureEnabled(flagKey, orgBContext);

      expect(enabledForA).toBe(true);
      expect(enabledForB).toBe(false);
    });

    it("should return false for non-existent feature flags", async () => {
      const isEnabled = await isFeatureEnabled(
        "non_existent_flag_xyz",
        orgAContext,
      );
      expect(isEnabled).toBe(false);
    });

    it("should list all feature flags", async () => {
      const flags = await listFeatureFlags();
      expect(flags.length).toBeGreaterThanOrEqual(2);
      expect(flags.some((f) => f.key.includes(uniqueSuffix))).toBe(true);
    });
  });

  describe("2. Traceability & PII Error Sanitization", () => {
    it("should generate end-to-end diagnostic context with trace and correlation IDs", () => {
      const diag = createDiagnosticContext(
        "lead.ingest_meta_ad",
        orgAContext,
        "meta-service",
      );

      expect(diag.trace_id).toBeDefined();
      expect(diag.correlation_id).toBe(orgAContext.correlationId);
      expect(diag.organization_id).toBe(orgAContext.organizationId);
      expect(diag.operation_name).toBe("lead.ingest_meta_ad");
      expect(diag.service_name).toBe("meta-service");
      expect(diag.timestamp).toBeDefined();
    });

    it("should scrub PII, auth tokens, phone numbers, and emails from diagnostic errors", () => {
      const rawError = new Error(
        "Failed for user ahmad.fouad@gmail.com with phone 01012345678 and token Bearer eyJhbGciOiJIUzI1NiJ9.secret",
      );
      const diag = createDiagnosticContext("crm.sync_contact", orgAContext);
      const sanitized = sanitizeDiagnosticError(rawError, diag);

      expect(sanitized.error_message).not.toContain("ahmad.fouad@gmail.com");
      expect(sanitized.error_message).toContain("[REDACTED_EMAIL]");

      expect(sanitized.error_message).not.toContain("01012345678");
      expect(sanitized.error_message).toContain("[REDACTED_PHONE]");

      expect(sanitized.error_message).not.toContain(
        "eyJhbGciOiJIUzI1NiJ9.secret",
      );
      expect(sanitized.error_message).toContain("Bearer [REDACTED_TOKEN]");

      expect(sanitized.trace_id).toBe(diag.trace_id);
      expect(sanitized.organization_id).toBe(orgAContext.organizationId);
    });
  });

  describe("3. Internal Operations Console & Multi-Tier Access Control", () => {
    it("should retrieve overall platform health metrics", async () => {
      const health = await getSystemHealthOverview();

      expect(health.database_connected).toBe(true);
      expect(health.active_organizations_count).toBeGreaterThanOrEqual(2);
      expect(health.uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(health.release_version).toBeDefined();
    });

    it("should record, list, and resolve tenant incidents with RLS isolation", async () => {
      // Record incident for Org A
      const incident = await recordTenantIncident(orgAContext, {
        severity: "HIGH",
        title: "Webhook connection timeout with Meta Graph API",
        details: { endpoint: "/v20.0/leads", retries: 3 },
      });

      expect(incident.id).toBeDefined();
      expect(incident.organization_id).toBe(orgAContext.organizationId);
      expect(incident.status).toBe("OPEN");

      // Org A lists incidents
      const orgAIncidents = await listTenantIncidents(orgAContext);
      expect(orgAIncidents.some((i) => i.id === incident.id)).toBe(true);

      // Org B cannot see Org A incidents (Zero Tenant Leak)
      const orgBIncidents = await listTenantIncidents(orgBContext);
      expect(orgBIncidents.some((i) => i.id === incident.id)).toBe(false);

      // Resolve incident
      const resolved = await resolveTenantIncident(orgAContext, incident.id);
      expect(resolved.status).toBe("RESOLVED");
      expect(resolved.resolved_at).toBeDefined();
    });

    it("should enforce 3-tier operational access levels (OBSERVE vs SAFE_OPS vs BREAK_GLASS)", async () => {
      // 1. Level OBSERVE cannot execute mutating actions
      await expect(
        executeSafeOpsAction("RETRY_JOB", { jobId: "123" }, "OBSERVE"),
      ).rejects.toThrow(/Access level 'OBSERVE' is read-only/);

      // 2. Level SAFE_OPS allows standard operational actions
      const safeResult = await executeSafeOpsAction(
        "RETRY_JOB",
        { jobId: "job_456" },
        "SAFE_OPS",
      );
      expect(safeResult.success).toBe(true);

      // 3. Level SAFE_OPS is rejected for EMERGENCY_REPAIR (requires BREAK_GLASS)
      await expect(
        executeSafeOpsAction("EMERGENCY_REPAIR", { dbFix: true }, "SAFE_OPS"),
      ).rejects.toThrow(/requires 'BREAK_GLASS' emergency authorization/);

      // 4. Level BREAK_GLASS allows EMERGENCY_REPAIR
      const emergencyResult = await executeSafeOpsAction(
        "EMERGENCY_REPAIR",
        { dbFix: true },
        "BREAK_GLASS",
      );
      expect(emergencyResult.success).toBe(true);
    });
  });
});
