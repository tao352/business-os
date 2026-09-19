import crypto from "node:crypto";

/**
 * Generates the expected X-Hub-Signature-256 header value for a given payload and app secret.
 * Used for testing, webhook verification, and outbound webhook delivery.
 */
export function signMetaPayload(
  payload: string | Buffer,
  appSecret: string,
): string {
  const hmac = crypto.createHmac("sha256", appSecret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Validates the cryptographic X-Hub-Signature-256 header sent by Meta using constant-time comparison.
 * Prevents timing attacks and verifies that the payload was not tampered with.
 *
 * @param payload - Raw request body (Buffer or string)
 * @param signatureHeader - The exact value of the `X-Hub-Signature-256` header (e.g. `sha256=abcdef...`)
 * @param appSecret - The Meta App Secret configured for the organization
 * @returns boolean - True if the signature is valid, false otherwise
 */
export function verifyMetaSignature(
  payload: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret || !payload) {
    return false;
  }

  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const signatureHash = signatureHeader.slice(7).trim();
  if (signatureHash.length !== 64) {
    return false;
  }

  try {
    const expectedHash = crypto
      .createHmac("sha256", appSecret)
      .update(payload)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedHash, "hex");
    const signatureBuffer = Buffer.from(signatureHash, "hex");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}
