import crypto from "node:crypto";
import { logger } from "@business-os/logger";

export interface BackupManifest {
  id: string;
  databaseName: string;
  releaseVersion: string;
  timestamp: string;
  sha256Checksum: string;
  sizeBytes: number;
  tablesIncluded: string[];
  status: "PENDING" | "COMPLETED" | "VERIFIED" | "FAILED";
}

export interface MigrationSafetyReport {
  safe: boolean;
  violations: string[];
  warnings: string[];
}

/**
 * Creates a structured backup manifest with cryptographic checksum (Master Plan Section 46).
 */
export function createBackupManifest(
  databaseName: string,
  backupContent: string,
  tablesIncluded: string[] = [],
): BackupManifest {
  const hash = crypto.createHash("sha256").update(backupContent).digest("hex");
  const sizeBytes = Buffer.byteLength(backupContent, "utf8");

  return {
    id: crypto.randomUUID(),
    databaseName,
    releaseVersion: process.env.APP_RELEASE_VERSION || "0.1.0",
    timestamp: new Date().toISOString(),
    sha256Checksum: hash,
    sizeBytes,
    tablesIncluded,
    status: "COMPLETED",
  };
}

/**
 * Verifies backup viability through checksum validation and integrity checks (Rule 46).
 * "A backup that has never been restored is not considered proven."
 */
export function verifyBackupViability(
  manifest: BackupManifest,
  actualContent: string,
): { verified: boolean; message: string } {
  if (manifest.sizeBytes === 0 || actualContent.length === 0) {
    return { verified: false, message: "Backup content or manifest is empty" };
  }

  const computedHash = crypto
    .createHash("sha256")
    .update(actualContent)
    .digest("hex");
  if (computedHash !== manifest.sha256Checksum) {
    logger.error(
      { manifestChecksum: manifest.sha256Checksum, computedHash },
      "Backup checksum mismatch - archive may be corrupted",
    );
    return {
      verified: false,
      message: "SHA-256 checksum mismatch: archive corrupted",
    };
  }

  // Basic SQL dump structure verification
  const containsSqlHeader =
    actualContent.includes("PostgreSQL") ||
    actualContent.includes("CREATE TABLE") ||
    actualContent.includes("INSERT INTO") ||
    actualContent.includes("COPY");

  if (!containsSqlHeader && actualContent.length > 50) {
    return {
      verified: false,
      message: "Backup archive does not contain valid PostgreSQL dump headers",
    };
  }

  manifest.status = "VERIFIED";
  logger.info(
    { backupId: manifest.id, sizeBytes: manifest.sizeBytes },
    "Backup verified viable",
  );

  return { verified: true, message: "Backup integrity verified successfully" };
}

/**
 * Validates SQL migration against dangerous DDL breaking the Expand-Migrate-Contract rule (Section 45).
 */
export function validateMigrationSafety(
  sqlContent: string,
): MigrationSafetyReport {
  const violations: string[] = [];
  const warnings: string[] = [];

  const lines = sqlContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("--") && line.length > 0);
  const cleanSql = lines.join(" ");

  // 1. Check for immediate DROP TABLE
  if (/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(cleanSql)) {
    violations.push(
      "Immediate DROP TABLE without soft deprecation breaks Expand-Migrate-Contract",
    );
  }

  // 2. Check for immediate DROP COLUMN
  if (/ALTER\s+TABLE\s+.*DROP\s+COLUMN/i.test(cleanSql)) {
    violations.push(
      "Immediate DROP COLUMN breaks active application instances; deprecate first",
    );
  }

  // 3. Check for destructive TRUNCATE
  if (/TRUNCATE\s+/i.test(cleanSql)) {
    violations.push(
      "TRUNCATE table is prohibited in zero-downtime production migrations",
    );
  }

  // 4. Warnings for potential table locks
  if (/ALTER\s+TABLE\s+.*ALTER\s+COLUMN\s+.*TYPE/i.test(cleanSql)) {
    warnings.push(
      "ALTER COLUMN TYPE may cause full table rewrite and lock under heavy scale",
    );
  }

  if (/CREATE\s+INDEX\s+(?!CONCURRENTLY)/i.test(cleanSql)) {
    warnings.push(
      "CREATE INDEX without CONCURRENTLY may lock table writes in production",
    );
  }

  return {
    safe: violations.length === 0,
    violations,
    warnings,
  };
}
