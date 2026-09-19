import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  issueTenantToken,
  verifyTenantToken,
} from '../packages/core/src/index.js';

describe('Auth & Cryptography Primitives', () => {
  describe('Password Hashing (scrypt)', () => {
    it('hashes passwords with unique random salts', async () => {
      const password = 'StrongPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(hash1.split(':')).toHaveLength(2);
      expect(hash2.split(':')).toHaveLength(2);
    });

    it('successfully verifies correct password against hash', async () => {
      const password = 'SecureBrokerPassword2026';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('rejects incorrect passwords and tampered hashes', async () => {
      const password = 'CorrectPassword123';
      const hash = await hashPassword(password);

      const isWrongValid = await verifyPassword('WrongPassword123', hash);
      expect(isWrongValid).toBe(false);

      const [salt, key] = hash.split(':');
      const tamperedHash = `${salt}:${key!.slice(0, -2)}00`;
      const isTamperedValid = await verifyPassword(password, tamperedHash);
      expect(isTamperedValid).toBe(false);
    });

    it('enforces minimum password length of 8 characters', async () => {
      await expect(hashPassword('short')).rejects.toThrow(
        'Password must be at least 8 characters long'
      );
    });
  });

  describe('JWT Tenant Session Tokens', () => {
    const mockPayload = {
      userId: 'user-0000-1111-2222',
      organizationId: 'org-aaaa-bbbb-cccc',
      role: 'ADMIN' as const,
      email: 'broker.admin@starsmall.com',
    };

    it('issues and verifies a valid tenant-bound JWT', async () => {
      const token = await issueTenantToken(mockPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const decoded = await verifyTenantToken(token);
      expect(decoded.userId).toBe(mockPayload.userId);
      expect(decoded.organizationId).toBe(mockPayload.organizationId);
      expect(decoded.role).toBe('ADMIN');
      expect(decoded.email).toBe(mockPayload.email);
    });

    it('rejects tampered JWT tokens', async () => {
      const token = await issueTenantToken(mockPayload);
      const parts = token.split('.');
      // Tamper with payload part
      const tamperedToken = `${parts[0]}.${parts[1]}abc.${parts[2]}`;

      await expect(verifyTenantToken(tamperedToken)).rejects.toThrow();
    });

    it('rejects expired tokens', async () => {
      // Issue a token expired 1 second ago
      const expiredToken = await issueTenantToken(mockPayload, '-1s');
      await expect(verifyTenantToken(expiredToken)).rejects.toThrow();
    });
  });
});
