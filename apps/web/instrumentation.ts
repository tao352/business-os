/**
 * Next.js server-side startup hook.
 *
 * Production fails closed if:
 * - critical env values are invalid
 * - the Web App is connected using a privileged DB role
 *
 * CI can force the DB-role verification with VERIFY_RUNTIME_DB_ROLE=true.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { validateWebEnvironment } = await import("./lib/env.js");
  validateWebEnvironment();

  const isStrictProduction =
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LOCAL_DEV_CREDS !== "true";

  const mustVerifyRuntimeRole =
    isStrictProduction || process.env.VERIFY_RUNTIME_DB_ROLE === "true";

  if (mustVerifyRuntimeRole) {
    const { assertLeastPrivilegeRuntimeDatabaseRole } =
      await import("@business-os/database");

    await assertLeastPrivilegeRuntimeDatabaseRole();
  }
}
