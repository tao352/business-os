import { describe, it, expect } from "vitest";
import {
  createBackupManifest,
  verifyBackupViability,
  validateMigrationSafety,
} from "../packages/core/src/ops/index.js";

describe("Phase 18: Production Deployment, Backup & Disaster Recovery Pipeline", () => {
  describe("1. Backup Manifest Generation & Checksum Calculations", () => {
    it("should generate a valid backup manifest with SHA-256 checksum and metadata", () => {
      const mockSqlDump = `
-- PostgreSQL database dump
-- Dumped from database version 16.2
CREATE TABLE users (id uuid primary key);
INSERT INTO users VALUES ('d0e82685-7fb5-4198-b6fd-75c6c5e1d262');
`;
      const manifest = createBackupManifest("business_os_prod", mockSqlDump, [
        "users",
      ]);

      expect(manifest.id).toBeDefined();
      expect(manifest.databaseName).toBe("business_os_prod");
      expect(manifest.status).toBe("COMPLETED");
      expect(manifest.sha256Checksum).toHaveLength(64); // SHA-256 hex string
      expect(manifest.sizeBytes).toBeGreaterThan(0);
      expect(manifest.tablesIncluded).toContain("users");
    });
  });

  describe("2. Backup Viability & Restore Drill (Rule 46)", () => {
    const validSqlDump = `
-- PostgreSQL database dump
CREATE TABLE organizations (id uuid primary key, name text);
`;

    it("should successfully verify a healthy backup dump matching its manifest checksum", () => {
      const manifest = createBackupManifest("business_os_prod", validSqlDump, [
        "organizations",
      ]);
      const result = verifyBackupViability(manifest, validSqlDump);

      expect(result.verified).toBe(true);
      expect(manifest.status).toBe("VERIFIED");
    });

    it("should reject a corrupted backup dump with mismatched checksum", () => {
      const manifest = createBackupManifest("business_os_prod", validSqlDump);
      const corruptedDump = validSqlDump + "\n-- CORRUPTED_DATA_INJECTED";
      const result = verifyBackupViability(manifest, corruptedDump);

      expect(result.verified).toBe(false);
      expect(result.message).toContain("checksum mismatch");
    });

    it("should reject empty or invalid non-SQL backup archives", () => {
      const emptyManifest = createBackupManifest("business_os_prod", "");
      const resultEmpty = verifyBackupViability(emptyManifest, "");
      expect(resultEmpty.verified).toBe(false);

      const junkContent =
        "THIS_IS_JUST_A_RANDOM_TEXT_FILE_NOT_A_POSTGRES_DUMP_AT_ALL_XYZ_1234567890";
      const junkManifest = createBackupManifest(
        "business_os_prod",
        junkContent,
      );
      const resultJunk = verifyBackupViability(junkManifest, junkContent);
      expect(resultJunk.verified).toBe(false);
      expect(resultJunk.message).toContain("valid PostgreSQL dump headers");
    });
  });

  describe("3. Expand-Migrate-Contract Migration Safety Validator (Section 45)", () => {
    it("should approve safe backward-compatible migrations", () => {
      const safeSql = `
        CREATE TABLE IF NOT EXISTS marketing_tags (
          id UUID PRIMARY KEY,
          tag_name VARCHAR(50) NOT NULL
        );
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS secondary_tag VARCHAR(50);
        CREATE POLICY tenant_isolation_tags ON marketing_tags FOR ALL USING (true);
      `;
      const report = validateMigrationSafety(safeSql);

      expect(report.safe).toBe(true);
      expect(report.violations).toHaveLength(0);
    });

    it("should flag dangerous DDL that violates Expand-Migrate-Contract", () => {
      const destructiveSql = `
        ALTER TABLE leads DROP COLUMN phone_number;
        DROP TABLE old_audit_archive;
        TRUNCATE TABLE active_deals;
      `;
      const report = validateMigrationSafety(destructiveSql);

      expect(report.safe).toBe(false);
      expect(report.violations.some((v) => v.includes("DROP COLUMN"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("DROP TABLE"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("TRUNCATE"))).toBe(true);
    });

    it("should provide non-blocking warnings for lock-prone DDL", () => {
      const lockingSql = `
        ALTER TABLE leads ALTER COLUMN email TYPE VARCHAR(300);
        CREATE INDEX idx_leads_source ON leads(source);
      `;
      const report = validateMigrationSafety(lockingSql);

      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings.some((w) => w.includes("ALTER COLUMN TYPE"))).toBe(
        true,
      );
      expect(report.warnings.some((w) => w.includes("CONCURRENTLY"))).toBe(
        true,
      );
    });
  });
});
