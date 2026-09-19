import { SignJWT, jwtVerify } from "jose";
import type { TenantRole } from "@business-os/types";

export interface TenantTokenPayload {
  userId: string;
  organizationId: string;
  role: TenantRole;
  email: string;
}

const DEFAULT_SECRET = "super-secret-jwt-signing-key-minimum-32-chars-for-dev";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
  return new TextEncoder().encode(secret);
}

/**
 * Issues a cryptographically signed JWT token bound to a specific tenant context.
 */
export async function issueTenantToken(
  payload: TenantTokenPayload,
  expiresIn: string = "7d",
): Promise<string> {
  const secret = getJwtSecret();

  return await new SignJWT({
    userId: payload.userId,
    organizationId: payload.organizationId,
    role: payload.role,
    email: payload.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setIssuer("business-os")
    .setAudience("business-os-app")
    .sign(secret);
}

/**
 * Verifies a JWT token signature and extracts the typed tenant context.
 * Throws an error if the token has expired or the cryptographic signature is invalid.
 */
export async function verifyTenantToken(
  token: string,
): Promise<TenantTokenPayload> {
  const secret = getJwtSecret();

  const { payload } = await jwtVerify(token, secret, {
    issuer: "business-os",
    audience: "business-os-app",
  });

  return {
    userId: payload.userId as string,
    organizationId: payload.organizationId as string,
    role: payload.role as TenantRole,
    email: payload.email as string,
  };
}
