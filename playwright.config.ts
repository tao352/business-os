import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-e2e",
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm --filter @business-os/web start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 30000,
        env: {
          PORT: "3000",

          DATABASE_URL:
            process.env.DATABASE_URL ||
            "postgres://app_user:app_password@localhost:5434/business_os",

          ALLOW_LOCAL_DEV_CREDS: "true",

          VERIFY_RUNTIME_DB_ROLE: process.env.VERIFY_RUNTIME_DB_ROLE || "true",

          EXPECTED_DATABASE_ROLE:
            process.env.EXPECTED_DATABASE_ROLE || "app_user",

          JWT_SECRET:
            process.env.JWT_SECRET ||
            "super-secret-jwt-signing-key-minimum-32-chars-for-dev",

          ENCRYPTION_KEY:
            process.env.ENCRYPTION_KEY ||
            "dev-encryption-key-32-bytes-secure!!",

          // Explicitly strip administrative database credentials from the
          // running Next.js process. The Playwright test harness may receive
          // TEST_ADMIN_DATABASE_URL, but the Web App must not.
          MIGRATOR_DATABASE_URL: "",
          TEST_ADMIN_DATABASE_URL: "",
        },
      },
});
