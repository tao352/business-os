import crypto from "node:crypto";
import type { TenantContext, DiagnosticContext } from "@business-os/types";

const RELEASE_VERSION = process.env.APP_RELEASE_VERSION || "0.1.0";

/**
 * Creates an end-to-end diagnostic and traceability context (Master Plan Section 40).
 */
export function createDiagnosticContext(
  operationName: string,
  context?: TenantContext,
  serviceName = "business-os-core",
): DiagnosticContext {
  return {
    trace_id: crypto.randomUUID(),
    correlation_id: context?.correlationId || crypto.randomUUID(),
    organization_id: context?.organizationId,
    operation_name: operationName,
    release_version: RELEASE_VERSION,
    service_name: serviceName,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Sanitizes an error message and stack trace to scrub PII and credentials (Master Plan Section 41).
 */
export function sanitizeDiagnosticError(
  error: unknown,
  context?: DiagnosticContext,
): Record<string, unknown> {
  let message = error instanceof Error ? error.message : String(error);
  let stack = error instanceof Error ? error.stack : undefined;

  // 1. Scrub Bearer & JWT tokens
  const tokenRegex =
    /Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi;
  message = message.replace(tokenRegex, "Bearer [REDACTED_TOKEN]");
  if (stack) stack = stack.replace(tokenRegex, "Bearer [REDACTED_TOKEN]");

  // 2. Scrub Passwords / Secrets
  const secretRegex =
    /(?:password|secret|apiKey|api_key|token|access_token|key)\s*[:=]\s*["']?[^"',\s]+["']?/gi;
  message = message.replace(secretRegex, "[REDACTED_SECRET]");
  if (stack) stack = stack.replace(secretRegex, "[REDACTED_SECRET]");

  // 3. Scrub Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  message = message.replace(emailRegex, "[REDACTED_EMAIL]");
  if (stack) stack = stack.replace(emailRegex, "[REDACTED_EMAIL]");

  // 4. Scrub Phone Numbers
  const phoneRegex = /(?:\+?20|0020)?0?1[0125]\d{8}/g;
  message = message.replace(phoneRegex, "[REDACTED_PHONE]");
  if (stack) stack = stack.replace(phoneRegex, "[REDACTED_PHONE]");

  return {
    error_message: message,
    error_stack: stack,
    trace_id: context?.trace_id,
    correlation_id: context?.correlation_id,
    organization_id: context?.organization_id,
    operation_name: context?.operation_name,
    service_name: context?.service_name,
    release_version: context?.release_version || RELEASE_VERSION,
    timestamp: context?.timestamp || new Date().toISOString(),
  };
}
