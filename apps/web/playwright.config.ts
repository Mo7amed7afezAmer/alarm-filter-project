// Playwright smoke test for /hourly. Runs its own API (:4200) + `next dev` on :3200 (separate build dir)
// against the alarms_test database (TEST_DATABASE_URL) with Gmail replaced by the files in
// tests/fixtures. Run: corepack pnpm test:e2e   (first time: npx playwright install chromium)
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const API_PORT = 4200;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // `next dev` compiles every route on first hit — minutes on a busy Windows box.
  timeout: 600_000,
  expect: { timeout: 180_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure", acceptDownloads: true, ...devices["Desktop Chrome"] },
  webServer: [
    {
      // The REST API (apps/api) — /api/* of the web server is proxied here. NEXTAUTH_SECRET
      // comes from .env.local (--env-file never overrides the variables set below).
      command: `npx tsx --env-file=.env.local ../api/src/main.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        API_PORT: String(API_PORT),
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
        HOURLY_GMAIL_MOCK_DIR: "../../tests/fixtures",
      },
    },
    {
      command: `next dev -p ${PORT}`,
      url: `${baseURL}/login`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXTAUTH_URL: baseURL,
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
        API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
