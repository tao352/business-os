import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  pool,
  migratorPool,
  runPendingMigrations,
} from "@business-os/database";
import {
  registerUser,
  createOrganization,
  createLead,
  createOpportunity,
} from "../packages/core/src/index.js";

async function main() {
  await runPendingMigrations();

  const uniqueA = crypto.randomBytes(4).toString("hex");
  const uniqueB = crypto.randomBytes(4).toString("hex");

  const emailA = `e2e.user.a.${uniqueA}@business-os.test`;
  const passwordA = "Password123!Secure";

  const userA = await registerUser({
    email: emailA,
    password: passwordA,
    fullName: "Alice Enterprise Admin",
  });

  const orgA = await createOrganization({
    userId: userA.id,
    name: `Enterprise Alpha ${uniqueA}`,
    slug: `alpha-${uniqueA}`,
  });

  const orgASecondary = await createOrganization({
    userId: userA.id,
    name: `Enterprise Alpha Secondary ${uniqueA}`,
    slug: `alpha-secondary-${uniqueA}`,
  });

  const leadA = await createLead(
    {
      organizationId: orgA.id,
      userId: userA.id,
      role: "OWNER",
      correlationId: `e2e-seed-${uniqueA}`,
    },
    {
      fullName: "E2E VIP Prospect",
      phone: "+201012345678",
      email: `vip.prospect.${uniqueA}@client.com`,
      source: "ORGANIC",
      budget: 500000,
    },
  );

  const opportunityA = await createOpportunity(
    {
      organizationId: orgA.id,
      userId: userA.id,
      role: "OWNER",
      correlationId: `e2e-opportunity-${uniqueA}`,
    },
    {
      leadId: leadA.id,
      title: "E2E Primary Opportunity",
      value: 2_500_000,
      currency: "EGP",
      expectedCloseDate: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  );

  const emailMarketing = `e2e.marketing.${uniqueA}@business-os.test`;
  const passwordMarketing = "Password123!Secure";
  const userMarketing = await registerUser({
    email: emailMarketing,
    password: passwordMarketing,
    fullName: "Mona Marketing Specialist",
  });

  // Fixture administration is intentionally done with the migrator/admin pool.
  await migratorPool.query(
    `INSERT INTO organization_memberships (
       organization_id,
       user_id,
       role,
       is_active
     )
     VALUES ($1, $2, 'MARKETING_USER', true)`,
    [orgA.id, userMarketing.id],
  );

  const emailFinance = `e2e.finance.${uniqueA}@business-os.test`;
  const passwordFinance = "Password123!Secure";
  const userFinance = await registerUser({
    email: emailFinance,
    password: passwordFinance,
    fullName: "Farah Finance Manager",
  });

  await migratorPool.query(
    `INSERT INTO organization_memberships (
       organization_id,
       user_id,
       role,
       is_active
     )
     VALUES ($1, $2, 'FINANCE', true)`,
    [orgA.id, userFinance.id],
  );

  const emailReadOnly = `e2e.readonly.${uniqueA}@business-os.test`;
  const passwordReadOnly = "Password123!Secure";
  const userReadOnly = await registerUser({
    email: emailReadOnly,
    password: passwordReadOnly,
    fullName: "Rami Read Only Auditor",
  });

  await migratorPool.query(
    `INSERT INTO organization_memberships (
       organization_id,
       user_id,
       role,
       is_active
     )
     VALUES ($1, $2, 'READ_ONLY', true)`,
    [orgA.id, userReadOnly.id],
  );

  await migratorPool.query(
    `INSERT INTO tasks (
       organization_id,
       lead_id,
       assigned_user_id,
       title,
       due_date,
       priority,
       is_completed
     )
     VALUES (
       $1,
       $2,
       $3,
       'Review contract clause 4.1',
       NOW() + interval '1 day',
       'HIGH',
       false
     )`,
    [orgA.id, leadA.id, userA.id],
  );

  const emailB = `e2e.user.b.${uniqueB}@business-os.test`;
  const passwordB = "Password123!Secure";
  const userB = await registerUser({
    email: emailB,
    password: passwordB,
    fullName: "Bob Beta Admin",
  });

  const orgB = await createOrganization({
    userId: userB.id,
    name: `Beta Corp ${uniqueB}`,
    slug: `beta-${uniqueB}`,
  });

  const leadB = await createLead(
    {
      organizationId: orgB.id,
      userId: userB.id,
      role: "OWNER",
      correlationId: `e2e-seed-${uniqueB}`,
    },
    {
      fullName: "Tenant B Secret Prospect",
      phone: "+201098765432",
      email: `secret.${uniqueB}@betacorp.com`,
      source: "META_ADS",
      budget: 1200000,
    },
  );

  const emailSwitch = `e2e.user.switch.${uniqueA}@business-os.test`;
  const passwordSwitch = "Password123!Secure";
  const userSwitch = await registerUser({
    email: emailSwitch,
    password: passwordSwitch,
    fullName: "Sam Switcher",
  });
  await migratorPool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
     VALUES ($1, $2, 'ADMIN', true), ($3, $2, 'ADMIN', true)`,
    [orgA.id, userSwitch.id, orgASecondary.id],
  );

  const emailCross = `e2e.user.cross.${uniqueA}@business-os.test`;
  const passwordCross = "Password123!Secure";
  const userCrossDenied = await registerUser({
    email: emailCross,
    password: passwordCross,
    fullName: "Dan Denied",
  });
  await migratorPool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
     VALUES ($1, $2, 'ADMIN', true)`,
    [orgA.id, userCrossDenied.id],
  );

  const emailRevoked = `e2e.user.revoked.${uniqueA}@business-os.test`;
  const passwordRevoked = "Password123!Secure";
  const userRevoked = await registerUser({
    email: emailRevoked,
    password: passwordRevoked,
    fullName: "Rachel Revoked",
  });
  await migratorPool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
     VALUES ($1, $2, 'ADMIN', true)`,
    [orgA.id, userRevoked.id],
  );

  const fixtureData = {
    userA: {
      id: userA.id,
      email: emailA,
      password: passwordA,
      fullName: "Alice Enterprise Admin",
    },
    userMarketing: {
      id: userMarketing.id,
      email: emailMarketing,
      password: passwordMarketing,
      fullName: "Mona Marketing Specialist",
      role: "MARKETING_USER",
    },
    userFinance: {
      id: userFinance.id,
      email: emailFinance,
      password: passwordFinance,
      fullName: "Farah Finance Manager",
      role: "FINANCE",
    },
    userReadOnly: {
      id: userReadOnly.id,
      email: emailReadOnly,
      password: passwordReadOnly,
      fullName: "Rami Read Only Auditor",
      role: "READ_ONLY",
    },
    userSwitch: {
      id: userSwitch.id,
      email: emailSwitch,
      password: passwordSwitch,
      fullName: "Sam Switcher",
    },
    userCrossDenied: {
      id: userCrossDenied.id,
      email: emailCross,
      password: passwordCross,
      fullName: "Dan Denied",
    },
    userRevoked: {
      id: userRevoked.id,
      email: emailRevoked,
      password: passwordRevoked,
      fullName: "Rachel Revoked",
    },
    orgA: {
      id: orgA.id,
      name: orgA.name,
      slug: orgA.slug,
    },
    orgASecondary: {
      id: orgASecondary.id,
      name: orgASecondary.name,
      slug: orgASecondary.slug,
    },
    leadA: {
      id: leadA.id,
      fullName: leadA.full_name,
      phone: leadA.phone,
      status: leadA.status,
    },
    opportunityA: {
      id: opportunityA.id,
      title: opportunityA.title,
      stage: opportunityA.stage,
      value: Number(opportunityA.value),
      currency: opportunityA.currency,
    },
    userB: {
      id: userB.id,
      email: emailB,
      password: passwordB,
      fullName: "Bob Beta Admin",
    },
    orgB: {
      id: orgB.id,
      name: orgB.name,
      slug: orgB.slug,
    },
    leadB: {
      id: leadB.id,
      fullName: leadB.full_name,
      phone: leadB.phone,
      status: leadB.status,
    },
  };

  const targetDir = path.resolve(process.cwd(), "tests-e2e");
  fs.mkdirSync(targetDir, { recursive: true });

  const targetPath = path.join(targetDir, "e2e-fixtures.json");
  fs.writeFileSync(targetPath, JSON.stringify(fixtureData, null, 2), "utf-8");

  console.log("Successfully seeded E2E test fixtures to", targetPath);

  await pool.end();
  await migratorPool.end();
}

main().catch(async (err) => {
  console.error("Failed to seed E2E fixtures:", err);

  try {
    await pool.end();
    await migratorPool.end();
  } catch {
    // ignore teardown failure
  }

  process.exit(1);
});
