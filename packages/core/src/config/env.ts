import { logger } from "@business-os/logger";

const DEV_FALLBACK_JWT = "dev-secret-jwt-signing-key-minimum-32-chars-2026";
const DEV_FALLBACK_ENCRYPTION_KEY = "dev-encryption-key-32-bytes-secure!!";

const KNOWN_WEAK_SECRETS = new Set([
  "secret",
  "jwt_secret",
  "password",
  "12345678",
  "super-secret-jwt-signing-key-minimum-32-chars-for-dev",
  DEV_FALLBACK_JWT,
]);

/**
 * Validates and retrieves the JWT signing secret.
 * In production (NODE_ENV === 'production'), fails closed immediately if missing or weak.
 */
export function getJwtSecret(): Uint8Array {
  const isProduction = process.env.NODE_ENV === "production";
  const rawSecret = process.env.JWT_SECRET;

  if (isProduction) {
    if (!rawSecret || rawSecret.trim().length === 0) {
      throw new Error(
        "FATAL SECURITY FAILURE: JWT_SECRET environment variable is missing in production environment. Application refusing to start.",
      );
    }

    if (rawSecret.length < 32) {
      throw new Error(
        "FATAL SECURITY FAILURE: JWT_SECRET in production must be at least 32 characters long for HS256 compliance.",
      );
    }

    if (KNOWN_WEAK_SECRETS.has(rawSecret.toLowerCase())) {
      throw new Error(
        "FATAL SECURITY FAILURE: JWT_SECRET in production cannot use a known default or trivial weak secret.",
      );
    }

    return new TextEncoder().encode(rawSecret);
  }

  // Development and test environments
  return new TextEncoder().encode(rawSecret || DEV_FALLBACK_JWT);
}

/**
 * Validates and retrieves the 32-byte master encryption key for sensitive integrations.
 * Fails closed in production if absent or insufficient length.
 */
export function getEncryptionKey(): Buffer {
  const isProduction = process.env.NODE_ENV === "production";
  const rawKey = process.env.ENCRYPTION_KEY;

  if (isProduction) {
    if (!rawKey || rawKey.trim().length === 0) {
      throw new Error(
        "FATAL SECURITY FAILURE: ENCRYPTION_KEY environment variable is missing in production environment. Application refusing to start.",
      );
    }

    if (Buffer.byteLength(rawKey, "utf8") < 32) {
      throw new Error(
        "FATAL SECURITY FAILURE: ENCRYPTION_KEY in production must be at least 32 bytes for AES-256-GCM.",
      );
    }

    return Buffer.from(rawKey.slice(0, 32), "utf8");
  }

  const keyToUse = rawKey || DEV_FALLBACK_ENCRYPTION_KEY;
  return Buffer.from(keyToUse.padEnd(32, "!").slice(0, 32), "utf8");
}

/**
 * Startup sanity check to fail-closed early on boot.
 */
export function validateEnvironment(): void {
  try {
    getJwtSecret();
    getEncryptionKey();
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Environment validation failed during startup",
    );
    throw err;
  }
}
