import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturesPath = path.resolve(__dirname, "e2e-fixtures.json");
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "mobile-390", width: 390, height: 844 },
];

const screenshotsDir = path.resolve(__dirname, "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Optional local artifact copy (gracefully skipped in CI)
const localArtifactsDir = process.env.ARTIFACTS_DIR
  ? path.resolve(process.env.ARTIFACTS_DIR, "screenshots")
  : null;
if (localArtifactsDir && !fs.existsSync(localArtifactsDir)) {
  try {
    fs.mkdirSync(localArtifactsDir, { recursive: true });
  } catch {}
}

function copyToArtifacts(sourcePath: string, fileName: string) {
  if (localArtifactsDir && fs.existsSync(localArtifactsDir)) {
    try {
      fs.copyFileSync(sourcePath, path.join(localArtifactsDir, fileName));
    } catch {}
  }
}

test.describe("Phase 21 Visual QA & Responsive Snapshot Suite", () => {
  test("Capture responsive screenshots across viewports for all key pages", async ({
    page,
  }) => {
    // 1. Capture Login across 3 viewports unauthenticated
    await page.context().clearCookies();
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/login");
      await page.waitForSelector("h1");
      const fileName = `login-${vp.name}.png`;
      const loginPath = path.join(screenshotsDir, fileName);
      await page.screenshot({ path: loginPath, fullPage: true });
      copyToArtifacts(loginPath, fileName);

      if (vp.name.startsWith("mobile")) {
        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasHorizontalOverflow,
          `Mobile login page has horizontal scroll overflow (scrollWidth > innerWidth)`,
        ).toBe(false);
      }
    }

    // 2. Perform Single Login
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userA.email);
    await page.locator('input[type="password"]').fill(fixtures.userA.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\?.*)?$/);

    // 3. For each primary authenticated page, capture across all 3 viewports & assert no mobile horizontal overflow
    const primaryRoutes = [
      { name: "app", path: "/app" },
      { name: "leads", path: "/app/leads" },
      { name: "lead-detail", path: `/app/leads/${fixtures.leadA.id}` },
      { name: "opportunities", path: "/app/opportunities" },
      {
        name: "opportunity-detail",
        path: `/app/opportunities/${fixtures.opportunityA.id}`,
      },
    ];

    for (const route of primaryRoutes) {
      await page.goto(route.path);
      await page.waitForSelector("h1");
      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(200); // allow responsive reflow
        const fileName = `${route.name}-${vp.name}.png`;
        const shotPath = path.join(screenshotsDir, fileName);
        await page.screenshot({ path: shotPath, fullPage: true });
        copyToArtifacts(shotPath, fileName);

        if (vp.name.startsWith("mobile")) {
          const hasHorizontalOverflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > window.innerWidth;
          });
          expect(
            hasHorizontalOverflow,
            `Mobile viewport on ${route.name} has horizontal scroll overflow (scrollWidth > innerWidth)`,
          ).toBe(false);
        }
      }
    }

    // 4. Capture secondary desktop pages
    const secondaryRoutes = [
      { name: "projects", path: "/app/projects" },
      { name: "units", path: "/app/units" },
      { name: "automations", path: "/app/automations" },
      { name: "integrations", path: "/app/integrations" },
      { name: "settings", path: "/app/settings" },
    ];

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of secondaryRoutes) {
      await page.goto(route.path);
      await page.waitForSelector("h1");
      const fileName = `${route.name}-desktop-1440.png`;
      const shotPath = path.join(screenshotsDir, fileName);
      await page.screenshot({ path: shotPath, fullPage: true });
      copyToArtifacts(shotPath, fileName);
    }
  });
});
