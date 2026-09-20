import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  registerUser,
  createOrganization,
  createLead,
} from "../packages/core/src/index.js";

async function main() {
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
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed E2E fixtures:", err);
  process.exit(1);
});
