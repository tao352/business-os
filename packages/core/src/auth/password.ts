import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hashes a plaintext password using NIST-approved scrypt with a cryptographic salt.
 * Formats output as: "salt:derivedKey" in hex.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored "salt:derivedKey" hash.
 * Employs crypto.timingSafeEqual to prevent side-channel timing attacks.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  const [salt, key] = storedHash.split(':');
  if (!salt || !key) {
    return false;
  }

  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

    if (keyBuffer.length !== derivedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}
