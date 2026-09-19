import { describe, it, expect, afterAll } from "vitest";
import crypto from "node:crypto";
import { pool } from "../packages/database/src/index.js";
import {
  registerUser,
  authenticateUser,
  createOrganization,
  switchOrganization,
  resolveTenantContextFromToken,
  AuthenticationError,
  AuthorizationError,
} from "../packages/core/src/index.js";

describe("Live Authentication & Multi-Tenancy Service", () => {
  const uniqueSuffix = crypto.randomBytes(4).toString("hex");
  const testEmail = `dev.broker.${uniqueSuffix}@realestate.local`;
  const testPassword = "MasterSecurePassword2026!";
  const testFullName = "Mohamed Al-Mansour";

  let createdUserId: string;
  let primaryOrgId: string;
  let secondaryOrgId: string;

  afterAll(async () => {
    await pool.end();
  });

  it("registers a new user with hashed password in PostgreSQL", async () => {
    const user = await registerUser({
      email: testEmail,
      password: testPassword,
      fullName: testFullName,
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);
    expect(user.full_name).toBe(testFullName);
    createdUserId = user.id;

    // Verify password_hash in database is NOT plaintext
    const dbUser = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [user.id],
    );
    expect(dbUser.rows[0].password_hash).not.toBe(testPassword);
    expect(dbUser.rows[0].password_hash.includes(":")).toBe(true);
  });

  it("rejects duplicate email registration", async () => {
    await expect(
      registerUser({
        email: testEmail,
        password: "AnotherPassword123!",
        fullName: "Duplicate User",
      }),
    ).rejects.toThrow("User with this email already exists");
  });

  it("authenticates user and returns empty organizations before provisioning", async () => {
    const authResult = await authenticateUser(testEmail, testPassword);
    expect(authResult.user.id).toBe(createdUserId);
    expect(authResult.user.email).toBe(testEmail);
    expect(authResult.organizations).toHaveLength(0);
    expect(authResult.primaryToken).toBeUndefined();
  });

  it("rejects login with incorrect password", async () => {
    await expect(
      authenticateUser(testEmail, "WrongPassword123!"),
    ).rejects.toThrow("Invalid email or password");
  });

  it("provisions a primary organization and appoints user as OWNER", async () => {
    const org = await createOrganization({
      userId: createdUserId,
      name: "Emaar Properties Hub",
      slug: `emaar-${uniqueSuffix}`,
      plan: "GROWTH",
    });

    expect(org.id).toBeDefined();
    expect(org.name).toBe("Emaar Properties Hub");
    primaryOrgId = org.id;

    // Verify membership in database
    const membership = await pool.query(
      "SELECT role, is_active FROM organization_memberships WHERE user_id = $1 AND organization_id = $2",
      [createdUserId, primaryOrgId],
    );
    expect(membership.rows[0].role).toBe("OWNER");
    expect(membership.rows[0].is_active).toBe(true);
  });

  it("provisions a secondary organization for the same user", async () => {
    const org = await createOrganization({
      userId: createdUserId,
      name: "Palm Hills Brokerage",
      slug: `palmhills-${uniqueSuffix}`,
      plan: "STARTER",
    });

    secondaryOrgId = org.id;
    expect(secondaryOrgId).toBeDefined();
    expect(secondaryOrgId).not.toBe(primaryOrgId);
  });

  it("authenticates user and returns all owned organizations with a primary session token", async () => {
    const authResult = await authenticateUser(testEmail, testPassword);
    expect(authResult.organizations).toHaveLength(2);

    const orgIds = authResult.organizations.map((o) => o.id);
    expect(orgIds).toContain(primaryOrgId);
    expect(orgIds).toContain(secondaryOrgId);

    expect(authResult.primaryToken).toBeDefined();

    // Verify resolving tenant context from the primary token
    const context = await resolveTenantContextFromToken(
      authResult.primaryToken,
    );
    expect(context.userId).toBe(createdUserId);
    expect(context.organizationId).toBe(primaryOrgId);
    expect(context.role).toBe("OWNER");
    expect(context.correlationId).toBeDefined();
  });

  it("switches tenant session to the secondary organization", async () => {
    const switchedToken = await switchOrganization({
      userId: createdUserId,
      targetOrganizationId: secondaryOrgId,
      email: testEmail,
    });

    const context = await resolveTenantContextFromToken(switchedToken);
    expect(context.userId).toBe(createdUserId);
    expect(context.organizationId).toBe(secondaryOrgId);
    expect(context.role).toBe("OWNER");
  });

  it("strictly rejects switching to an organization where the user has NO membership", async () => {
    // Create an alien organization owned by someone else
    const alienOrg = await pool.query(
      "INSERT INTO organizations (name, slug) VALUES ('Alien Real Estate', 'alien-' || gen_random_uuid()) RETURNING id",
    );
    const alienOrgId = alienOrg.rows[0].id;

    await expect(
      switchOrganization({
        userId: createdUserId,
        targetOrganizationId: alienOrgId,
        email: testEmail,
      }),
    ).rejects.toThrow("User does not have access to this organization");
  });

  it("middleware revokes access if membership is deactivated in database", async () => {
    // Issue token for secondary organization
    const token = await switchOrganization({
      userId: createdUserId,
      targetOrganizationId: secondaryOrgId,
      email: testEmail,
    });

    // Deactivate membership directly in database
    await pool.query(
      "UPDATE organization_memberships SET is_active = false WHERE user_id = $1 AND organization_id = $2",
      [createdUserId, secondaryOrgId],
    );

    // Resolving context MUST now throw AuthorizationError even with a valid cryptographic token!
    await expect(resolveTenantContextFromToken(token)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(resolveTenantContextFromToken(token)).rejects.toThrow(
      "Access to this organization has been revoked",
    );
  });
});
