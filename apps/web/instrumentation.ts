/**
 * Next.js Server-Side Instrumentation Hook.
 * Automatically executed by Next.js once on server boot before handling requests.
 * Fails closed in production if critical security environment variables are missing or insecure.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateWebEnvironment } = await import("./lib/env.js");
    validateWebEnvironment();
  }
}
