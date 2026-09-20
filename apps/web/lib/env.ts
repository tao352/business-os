import { logger } from "@business-os/logger";

/**
 * Validates critical environment variables on server boot.
 * Fails closed immediately in production if any mandatory variable is missing or insecure.
 */
export function validateWebEnvironment(): void {
  const isProduction =
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LOCAL_DEV_CREDS !== "true";

  if (isProduction) {
    if (
      !process.env.DATABASE_URL ||
      process.env.DATABASE_URL.trim().length === 0
    ) {
      throw new Error(
        "FATAL CONFIGURATION ERROR: DATABASE_URL is missing in production. Startup aborted.",
      );
    }

    if (
      process.env.DATABASE_URL.includes("postgres:postgrespassword@") ||
      process.env.DATABASE_URL.includes("localhost")
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: DATABASE_URL cannot use default credentials or localhost in production.",
      );
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
      throw new Error(
        "FATAL SECURITY ERROR: JWT_SECRET must be at least 32 characters long in production.",
      );
    }

    if (
      !process.env.ENCRYPTION_KEY ||
      process.env.ENCRYPTION_KEY.trim().length < 32
    ) {
      throw new Error(
        "FATAL SECURITY ERROR: ENCRYPTION_KEY must be at least 32 bytes in production.",
      );
    }
  }

  logger.info(
    { env: process.env.NODE_ENV || "development" },
    "Application environment configuration validated successfully.",
  );
}
