import crypto from "node:crypto";
import { getEncryptionKey } from "../config/env.js";

export class DecryptionError extends Error {
  constructor(message: string) {
    super(`Decryption Error: ${message}`);
    this.name = "DecryptionError";
  }
}

/**
 * Encrypts a plaintext secret using AES-256-GCM with a unique 12-byte IV per value.
 * Stored payload format: v1:<hex_iv>:<hex_auth_tag>:<hex_ciphertext>
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || typeof plaintext !== "string") {
    return plaintext;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag(); // 128-bit authentication tag

  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a v1 AES-256-GCM encrypted payload with authentication tag validation.
 * Backward compatible: if payload does not start with 'v1:', returns payload as legacy plaintext.
 */
export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== "string") {
    return payload;
  }

  if (!payload.startsWith("v1:")) {
    // Legacy plaintext support for seamless migration
    return payload;
  }

  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new DecryptionError("Malformed encrypted secret format");
  }

  const [, ivHex, tagHex, ciphertextHex] = parts;
  if (!ivHex || !tagHex || !ciphertextHex) {
    throw new DecryptionError("Missing components in encrypted secret");
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    throw new DecryptionError(
      `Failed to authenticate and decrypt payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Returns a masked representation of a secret suitable for safe DTO responses.
 * Never exposes the raw token in client-facing APIs.
 */
export function maskSecret(secret: string): string {
  if (!secret || typeof secret !== "string") {
    return "********";
  }

  // If secret is an encrypted token, decrypt it first to calculate mask
  let plain = secret;
  if (secret.startsWith("v1:")) {
    try {
      plain = decryptSecret(secret);
    } catch {
      return "********";
    }
  }

  if (plain.length <= 8) {
    return "********";
  }

  const start = plain.slice(0, 4);
  const end = plain.slice(-4);
  return `${start}********${end}`;
}
