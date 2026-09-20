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

// Artifacts dir for Antigravity inspection
const artifactsDir =
  "C:\\Users\\aemsh\\.gemini\\antigravity\\brain\\ab2694e8-ae54-44b7-b6e7-b817ca74d5a8\\screenshots";
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
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
      const loginPath = path.join(screenshotsDir, `login-${vp.name}.png`);
      await page.screenshot({ path: loginPath, fullPage: true });
      fs.copyFileSync(
        loginPath,
        path.join(artifactsDir, `login-${vp.name}.png`),
      );
    }

    // 2. Perform Single Login
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(fixtures.userA.email);
    await page.locator('input[type="password"]').fill(fixtures.userA.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/app(\?.*)?$/);

    // 3. For each authenticated page, capture across all 3 viewports
    const routes = [
      { name: "app", path: "/app" },
      { name: "leads", path: "/app/leads" },
      { name: "lead-detail", path: `/app/leads/${fixtures.leadA.id}` },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await page.waitForSelector("h1");
      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(200); // allow responsive reflow
        const shotPath = path.join(
          screenshotsDir,
          `${route.name}-${vp.name}.png`,
        );
        await page.screenshot({ path: shotPath, fullPage: true });
        fs.copyFileSync(
          shotPath,
          path.join(artifactsDir, `${route.name}-${vp.name}.png`),
        );
      }
    }
  });
});
