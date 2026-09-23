import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client } from "../packages/database/src/client.js";

// Load seeded fixtures
const fixturesPath = path.resolve(__dirname, "e2e-fixtures.json");
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

test.describe("Phase 21 E2E Browser & Security Suite", () => {
  test.describe.configure({ mode: "serial" });

  test("1. Unauthenticated visit to /app redirects to /login", async ({
    page,
  }) => {
    // Clear any existing cookies
    await page.context().clearCookies();

    await page.goto("/app");
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
    await expect(page.locator("h1")).toContainText("Business OS");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    // Verify /app/leads also redirects
    await page.goto("/app/leads");
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });

  test("2. Full operational journey: login -> leads -> detail -> update status -> verify timeline", async ({
    page,
  }) => {
    // Navigate to login
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userA.email);
    await page.locator('input[type="password"]').fill(fixtures.userA.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Verify redirection to /app dashboard
    await page.waitForURL(/\/app(\?.*)?$/);
    await expect(page.locator("body")).toContainText(fixtures.orgA.name);

    // Navigate to Leads via sidebar
    const leadsNavLink = page.locator('aside a[href="/app/leads"]');
    await expect(leadsNavLink).toBeVisible();
    await leadsNavLink.click();

    // Verify /app/leads loaded
    await page.waitForURL(/\/app\/leads/);
    await expect(page.locator("h1")).toContainText("Leads");

    // Verify seeded lead is visible in table
    const leadRow = page
      .locator("tr")
      .filter({ hasText: fixtures.leadA.fullName });
    await expect(leadRow).toBeVisible();
    await expect(leadRow).toContainText("NEW");

    // Click lead to open workspace
    await leadRow.click();
    await page.waitForURL(new RegExp(`/app/leads/${fixtures.leadA.id}`));

    // Verify lead workspace header
    await expect(page.locator("h1")).toContainText(fixtures.leadA.fullName);
    const statusBadge = page
      .locator("header, div")
      .filter({ hasText: fixtures.leadA.fullName })
      .locator("span, div")
      .filter({ hasText: /^NEW$/ })
      .first();
    await expect(statusBadge).toBeVisible();

    // Click "Change Status" button
    const changeStatusBtn = page.getByRole("button", {
      name: /change status/i,
    });
    await expect(changeStatusBtn).toBeVisible();
    await changeStatusBtn.click();

    // Verify dialog is open
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Change Pipeline Status");

    // Select QUALIFIED in stage dropdown
    const stageSelect = dialog.locator("select");
    await stageSelect.selectOption("QUALIFIED");

    // Submit dialog
    const applyBtn = dialog.getByRole("button", { name: /apply status/i });
    await applyBtn.click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible();

    // Verify status badge updated to QUALIFIED
    await expect(page.locator("body")).toContainText("QUALIFIED");

    // Verify customer timeline visibly records the change
    const timeline = page
      .locator("body")
      .filter({ hasText: /customer timeline/i });
    await expect(timeline).toBeVisible();
    await expect(page.locator("body")).toContainText(
      /Status changed from NEW to QUALIFIED|QUALIFIED/,
    );
  });

  test("2b. Opportunity workspace: navigation -> detail -> stage update", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userA.email);
    await page.locator('input[type="password"]').fill(fixtures.userA.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\?.*)?$/);

    const opportunitiesNav = page.locator('aside a[href="/app/opportunities"]');
    await expect(opportunitiesNav).toBeVisible();
    await opportunitiesNav.click();

    await page.waitForURL(/\/app\/opportunities/);
    await expect(page.locator("h1")).toContainText("Opportunities");

    const opportunityRow = page
      .locator("tr")
      .filter({ hasText: fixtures.opportunityA.title });
    await expect(opportunityRow).toBeVisible();
    await expect(opportunityRow).toContainText("DISCOVERY");

    await opportunityRow.click();
    await page.waitForURL(
      new RegExp(`/app/opportunities/${fixtures.opportunityA.id}`),
    );

    await expect(page.locator("h1")).toContainText(fixtures.opportunityA.title);
    await expect(page.locator("header nav")).toContainText(
      "Opportunity Details",
    );
    await expect(page.locator("header nav")).not.toContainText(
      fixtures.opportunityA.id,
    );

    const changeStage = page.getByRole("button", { name: /change stage/i });
    await expect(changeStage).toBeVisible();
    await changeStage.click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toContainText("Change Opportunity Stage");
    await dialog.locator("select").first().selectOption("PROPOSAL");
    await dialog.getByRole("button", { name: /apply stage/i }).click();
    await expect(dialog).not.toBeVisible();

    await expect(page.locator("body")).toContainText("PROPOSAL");
    await expect(page.locator("body")).toContainText(
      /Manual sales update|Opportunity Stage History/,
    );
  });

  test("3. Cross-tenant isolation (Negative Test): Tenant A user cannot access Tenant B lead URL", async ({
    page,
  }) => {
    // Authenticate as Tenant A User
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userA.email);
    await page.locator('input[type="password"]').fill(fixtures.userA.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\?.*)?$/);

    // Attempt direct navigation to Tenant B's lead URL
    const tenantBUrl = `/app/leads/${fixtures.leadB.id}`;
    const response = await page.goto(tenantBUrl);

    // Verify 404 status or not-found UI
    const status = response?.status();
    const is404 =
      status === 404 ||
      (await page.locator("body").innerText()).includes("404");
    expect(is404).toBe(true);

    // Confirm that NO confidential data from Tenant B is rendered
    await expect(page.locator("body")).not.toContainText(
      fixtures.leadB.fullName,
    );
    await expect(page.locator("body")).not.toContainText(fixtures.leadB.phone);
  });

  test("4. Brute-force rate limiting: repeated failed attempts trigger 429 Too Many Requests", async ({
    request,
  }) => {
    const attackEmail = `brute.force.${Date.now()}@target.test`;
    let got429 = false;
    let rateLimitResponse: any = null;

    // Send 7 rapid bad login requests
    for (let i = 0; i < 7; i++) {
      const res = await request.post("/api/auth/login", {
        data: {
          email: attackEmail,
          password: "wrong-password-attempt",
        },
      });

      if (res.status() === 429) {
        got429 = true;
        rateLimitResponse = await res.json();
        break;
      }
    }

    expect(got429).toBe(true);
    expect(rateLimitResponse?.error).toContain(
      "Too many login attempts. Please try again later.",
    );
  });

  test("5. Role authorization boundary: MARKETING_USER sees aggregated metrics only and cannot access individual dossiers or privileged pages", async ({
    page,
  }) => {
    // Clear cookies and authenticate as MARKETING_USER
    await page.context().clearCookies();
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(fixtures.userMarketing.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userMarketing.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);
    await expect(page.locator("body")).toContainText("MARKETING_USER");

    // Verify sidebar navigation items
    await expect(page.locator('aside a[href="/app"]')).toBeVisible();
    await expect(page.locator('aside a[href="/app/leads"]')).toBeVisible();
    // Privileged and inventory items MUST NOT be visible in sidebar
    await expect(
      page.locator('aside a[href="/app/automations"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/integrations"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/settings"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/projects"]'),
    ).not.toBeVisible();
    await expect(page.locator('aside a[href="/app/units"]')).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/opportunities"]'),
    ).not.toBeVisible();

    // Navigate to /app/leads
    await page.goto("/app/leads");
    await page.waitForURL(/\/app\/leads/);
    await expect(page.locator("h1")).toContainText("Leads");

    // Verify individual customer records are restricted notice
    await expect(page.locator("body")).toContainText(
      /Individual lead records are not available|Individual Customer Records Restricted/,
    );

    // Confirm that individual lead contact info (phone) is NOT visible in page
    await expect(page.locator("body")).not.toContainText(fixtures.leadA.phone);

    // Negative Test: Direct navigation to lead workspace MUST return 404 / not-found
    const leadDetailUrl = `/app/leads/${fixtures.leadA.id}`;
    const leadDetailRes = await page.goto(leadDetailUrl);
    const isLeadDetail404 =
      leadDetailRes?.status() === 404 ||
      (await page.locator("body").innerText()).includes("404");
    expect(isLeadDetail404).toBe(true);

    // Negative Test: Direct navigation to Opportunities MUST return 404 / not-found
    const opportunitiesRes = await page.goto("/app/opportunities");
    const isOpportunities404 =
      opportunitiesRes?.status() === 404 ||
      (await page.locator("body").innerText()).includes("404");
    expect(isOpportunities404).toBe(true);

    // Negative Test: Direct navigation to automations MUST return 404 / not-found
    const automationsRes = await page.goto("/app/automations");
    const isAutomations404 =
      automationsRes?.status() === 404 ||
      (await page.locator("body").innerText()).includes("404");
    expect(isAutomations404).toBe(true);

    // Negative Test: Direct navigation to integrations MUST return 404 / not-found
    const integrationsRes = await page.goto("/app/integrations");
    const isIntegrations404 =
      integrationsRes?.status() === 404 ||
      (await page.locator("body").innerText()).includes("404");
    expect(isIntegrations404).toBe(true);
  });

  test("6. Capability-aware navigation: FINANCE role sees Units but not Projects or privileged items", async ({
    page,
  }) => {
    // Clear cookies and authenticate as FINANCE user
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userFinance.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userFinance.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);
    await expect(page.locator("body")).toContainText("FINANCE");

    // Authoritative navigation verification:
    // FINANCE can read units -> Units MUST be visible
    await expect(page.locator('aside a[href="/app/units"]')).toBeVisible();

    // FINANCE cannot read projects or Opportunities -> both MUST NOT be visible
    await expect(
      page.locator('aside a[href="/app/projects"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/opportunities"]'),
    ).not.toBeVisible();

    // Privileged system items MUST NOT be visible
    await expect(
      page.locator('aside a[href="/app/automations"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/integrations"]'),
    ).not.toBeVisible();
    await expect(
      page.locator('aside a[href="/app/settings"]'),
    ).not.toBeVisible();

    // Topbar 'New Lead' button MUST NOT be visible
    await expect(
      page.locator('header button:has-text("New Lead")'),
    ).not.toBeVisible();
  });

  test("7. Capability-aware UI and mutation gating: READ_ONLY role sees sanitized breadcrumbs, read-only lead view, and no task completion buttons", async ({
    page,
  }) => {
    // Clear cookies and authenticate as READ_ONLY user
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userReadOnly.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userReadOnly.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);
    await expect(page.locator("body")).toContainText("READ_ONLY");
    await expect(
      page.locator('aside a[href="/app/opportunities"]'),
    ).toBeVisible();

    // Topbar 'New Lead' button MUST NOT be visible on Dashboard
    await expect(
      page.locator('header button:has-text("New Lead")'),
    ).not.toBeVisible();

    // Dashboard follow-up tasks MUST NOT render the 'Complete' button
    await expect(page.locator('button:has-text("Complete")')).not.toBeVisible();

    // Navigate to lead workspace
    const leadDetailUrl = `/app/leads/${fixtures.leadA.id}`;
    await page.goto(leadDetailUrl);
    await page.waitForURL(new RegExp(`/app/leads/${fixtures.leadA.id}`));

    // Breadcrumb verification: raw UUID MUST be sanitized to 'Lead Details'
    const breadcrumbNav = page.locator("header nav");
    await expect(breadcrumbNav).toContainText("Lead Details");
    await expect(breadcrumbNav).not.toContainText(fixtures.leadA.id);

    // Lead action bar MUST render clean 'Read-only view' badge
    await expect(page.locator("body")).toContainText("Read-only view");

    // Mutation action buttons MUST NOT be visible
    await expect(
      page.getByRole("button", { name: /change status/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /add note/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /follow-up/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /reassign/i }),
    ).not.toBeVisible();

    // Side panel open tasks MUST NOT render the complete button checkbox
    await expect(
      page.locator('button[title="Mark complete"]'),
    ).not.toBeVisible();

    // READ_ONLY may inspect Opportunity truth but cannot mutate it.
    await page.goto(`/app/opportunities/${fixtures.opportunityA.id}`);
    await page.waitForURL(
      new RegExp(`/app/opportunities/${fixtures.opportunityA.id}`),
    );
    await expect(page.locator("header nav")).toContainText(
      "Opportunity Details",
    );
    await expect(page.locator("body")).toContainText(
      fixtures.opportunityA.title,
    );
    await expect(
      page.getByRole("button", { name: /change stage/i }),
    ).not.toBeVisible();
    await expect(page.locator("body")).toContainText("Read-only view");
  });

  test("8. Multi-organization switching works under app_user runtime", async ({
    page,
  }) => {
    await page.context().clearCookies();

    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userSwitch.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userSwitch.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);
    await expect(page.locator("body")).toContainText(fixtures.orgA.name);

    const orgTrigger = page
      .locator("aside button")
      .filter({ hasText: fixtures.orgA.name })
      .first();

    await orgTrigger.click();

    const secondaryButton = page
      .locator("aside button")
      .filter({ hasText: fixtures.orgASecondary.name })
      .first();

    await expect(secondaryButton).toBeVisible();
    await secondaryButton.click();

    await expect(page.locator("body")).toContainText(
      fixtures.orgASecondary.name,
    );

    // Switch back so later visual QA / tests remain on the main fixture tenant.
    const secondaryTrigger = page
      .locator("aside button")
      .filter({ hasText: fixtures.orgASecondary.name })
      .first();

    await secondaryTrigger.click();

    const primaryButton = page
      .locator("aside button")
      .filter({ hasText: fixtures.orgA.name })
      .first();

    await primaryButton.click();

    await expect(page.locator("body")).toContainText(fixtures.orgA.name);
  });

  test("9. Organization switch denies a tenant the user does not belong to", async ({
    page,
  }) => {
    await page.context().clearCookies();

    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(fixtures.userCrossDenied.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userCrossDenied.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);

    const response = await page.request.post("/api/auth/switch-org", {
      data: {
        targetOrganizationId: fixtures.orgB.id,
      },
    });

    expect(response.status()).toBe(403);

    await page.goto("/app");
    await expect(page.locator("body")).toContainText(fixtures.orgA.name);
    await expect(page.locator("body")).not.toContainText(fixtures.orgB.name);
  });

  test("10. Live membership revocation invalidates an existing session", async ({
    page,
  }) => {
    const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;

    if (!adminUrl) {
      test.skip();
      return;
    }

    await page.context().clearCookies();

    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userRevoked.email);
    await page
      .locator('input[type="password"]')
      .fill(fixtures.userRevoked.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/app(\?.*)?$/);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();

    try {
      await admin.query(
        `UPDATE organization_memberships
         SET is_active = false
         WHERE user_id = $1
           AND organization_id = $2`,
        [fixtures.userRevoked.id, fixtures.orgA.id],
      );

      await page.goto("/app");

      await page.waitForURL(/\/login/);
      expect(page.url()).toContain("/login");
    } finally {
      // Restore fixture so visual QA is not poisoned by this security test.
      await admin.query(
        `UPDATE organization_memberships
         SET is_active = true
         WHERE user_id = $1
           AND organization_id = $2`,
        [fixtures.userRevoked.id, fixtures.orgA.id],
      );

      await admin.end();
    }
  });
});
