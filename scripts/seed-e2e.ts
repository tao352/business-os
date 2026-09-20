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
} from "../packages/core/src/index.js";

async function main() {
  await runPendingMigrations();

  const uniqueA = crypto.randomBytes(4).toString("hex");
  const uniqueB = crypto.randomBytes(4).toString("hex");

  // Seed Tenant A (Primary Test Tenant)
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

  // Seed Marketing User in Tenant A (Aggregated-only role)
  const emailMarketing = `e2e.marketing.${uniqueA}@business-os.test`;
  const passwordMarketing = "Password123!Secure";
  const userMarketing = await registerUser({
    email: emailMarketing,
    password: passwordMarketing,
    fullName: "Mona Marketing Specialist",
  });

  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
     VALUES ($1, $2, 'MARKETING_USER', true)`,
    [orgA.id, userMarketing.id],
  );

  // Seed Tenant B (For Cross-Tenant Isolation Negative Test)
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
    orgA: { id: orgA.id, name: orgA.name, slug: orgA.slug },
    leadA: {
      id: leadA.id,
      fullName: leadA.full_name,
      phone: leadA.phone,
      status: leadA.status,
    },
    userB: {
      id: userB.id,
      email: emailB,
      password: passwordB,
      fullName: "Bob Beta Admin",
    },
    orgB: { id: orgB.id, name: orgB.name, slug: orgB.slug },
    leadB: {
      id: leadB.id,
      fullName: leadB.full_name,
      phone: leadB.phone,
      status: leadB.status,
    },
  };

  const targetDir = path.resolve(process.cwd(), "tests-e2e");
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const targetPath = path.join(targetDir, "e2e-fixtures.json");
  fs.writeFileSync(targetPath, JSON.stringify(fixtureData, null, 2), "utf-8");

  console.log("Successfully seeded E2E test fixtures to", targetPath);
  await pool.end();
  await migratorPool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Failed to seed E2E fixtures:", err);
  try {
    await pool.end();
    await migratorPool.end();
  } catch {}
  process.exit(1);
});
