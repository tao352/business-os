import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { pool } from '../packages/database/src/index.js';
import type { TenantContext } from '@business-os/types';
import {
  registerUser,
  createOrganization,
  inviteMember,
  updateMemberRole,
  removeMember,
  listOrganizationMembers,
  ForbiddenError,
} from '../packages/core/src/index.js';

describe('Live Team & Member Management Service', () => {
  const uniqueSuffix = crypto.randomBytes(4).toString('hex');
  let ownerContext: TenantContext;
  let ownerUserId: string;
  let organizationId: string;

  let salesManagerUserId: string;
  let salespersonUserId: string;

  beforeAll(async () => {
    // 1. Create Owner user & organization
    const owner = await registerUser({
      email: `founder.${uniqueSuffix}@brokerage.local`,
      password: 'FounderPassword2026!',
      fullName: 'Tarek El-Masry',
    });
    ownerUserId = owner.id;

    const org = await createOrganization({
      userId: ownerUserId,
      name: 'Skyline Real Estate Group',
      slug: `skyline-${uniqueSuffix}`,
    });
    organizationId = org.id;

    ownerContext = {
      organizationId,
      userId: ownerUserId,
      role: 'OWNER',
      correlationId: 'test-correlation-id',
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  it('owner can invite a SALES_MANAGER to the organization', async () => {
    const member = await inviteMember(ownerContext, {
      email: `manager.${uniqueSuffix}@brokerage.local`,
      role: 'SALES_MANAGER',
      fullName: 'Omar Sherif',
    });

    expect(member.userId).toBeDefined();
    expect(member.role).toBe('SALES_MANAGER');
    salesManagerUserId = member.userId;

    const members = await listOrganizationMembers(ownerContext);
    expect(members.map((m) => m.user_id)).toContain(salesManagerUserId);
  });

  it('owner can invite a SALESPERSON to the organization', async () => {
    const member = await inviteMember(ownerContext, {
      email: `agent.${uniqueSuffix}@brokerage.local`,
      role: 'SALESPERSON',
      fullName: 'Kareem Adel',
    });

    expect(member.userId).toBeDefined();
    expect(member.role).toBe('SALESPERSON');
    salespersonUserId = member.userId;
  });

  it('SALESPERSON is strictly forbidden from inviting new members', async () => {
    const agentContext: TenantContext = {
      organizationId,
      userId: salespersonUserId,
      role: 'SALESPERSON',
      correlationId: 'unauthorized-req-123',
    };

    await expect(
      inviteMember(agentContext, {
        email: `hacker.${uniqueSuffix}@brokerage.local`,
        role: 'ADMIN',
        fullName: 'Hacker Agent',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('owner can promote a SALESPERSON to SALES_MANAGER', async () => {
    await updateMemberRole(ownerContext, salespersonUserId, 'SALES_MANAGER');

    const members = await listOrganizationMembers(ownerContext);
    const updated = members.find((m) => m.user_id === salespersonUserId);
    expect(updated?.role).toBe('SALES_MANAGER');
  });

  it('prevents demoting or removing the sole remaining OWNER', async () => {
    // Attempting to demote the owner to SALESPERSON
    await expect(
      updateMemberRole(ownerContext, ownerUserId, 'SALESPERSON')
    ).rejects.toThrow('Cannot demote the last OWNER of an organization');

    // Attempting to remove the owner
    await expect(
      removeMember(ownerContext, ownerUserId)
    ).rejects.toThrow('Cannot remove the last OWNER of an organization');
  });

  it('allows owner demotion if another OWNER exists', async () => {
    // 1. Promote Sales Manager to co-OWNER
    await updateMemberRole(ownerContext, salesManagerUserId, 'OWNER');

    // 2. Now demoting original owner to ADMIN should succeed!
    const result = await updateMemberRole(ownerContext, ownerUserId, 'ADMIN');
    expect(result.newRole).toBe('ADMIN');

    // Restore original owner as OWNER for subsequent operations
    await updateMemberRole(
      { ...ownerContext, userId: salesManagerUserId, role: 'OWNER' },
      ownerUserId,
      'OWNER'
    );
  });

  it('allows deactivating a member and verifies they are marked inactive', async () => {
    await removeMember(ownerContext, salespersonUserId);

    const members = await listOrganizationMembers(ownerContext);
    const deactivated = members.find((m) => m.user_id === salespersonUserId);
    expect(deactivated?.is_active).toBe(false);
  });
});
