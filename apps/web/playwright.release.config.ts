import { defineConfig, devices } from "@playwright/test";

/*
 * Release end-to-end suite (Stage 9): the brief's 16 Final Acceptance Criteria through the real UI
 * against a live API, worker and web app on dedicated e2e databases. Start everything with
 * `pnpm e2e:release` (infra/e2e/release-stack.mjs), which also runs this config; it never starts a
 * web server itself. Every spec is skipped unless E2E_RELEASE=1.
 *
 * Projects:
 *   setup          signs the seeded users in once per project and stores their sessions
 *   release-1440   the full flow on a desktop
 *   release-375    the full flow again on a phone (touch, mobile viewport)
 *   smoke-240, smoke-768, smoke-1024   sign-in, directory, business detail, pipeline and billing
 * One worker: the stack is shared and every flow counts money, credits and jobs exactly.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3300";
const OUTPUT = process.env.E2E_OUTPUT_DIR ?? "test-results/release";

const desktop = (width: number) => ({
  ...devices["Desktop Chrome"],
  viewport: { width, height: 900 },
  deviceScaleFactor: 1,
});
const touch = (width: number) => ({
  ...devices["Desktop Chrome"],
  viewport: { width, height: 800 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 1,
});

export default defineConfig({
  testDir: "./e2e/release",
  outputDir: OUTPUT,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { outputFolder: "playwright-report/release", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report/release", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /setup\/.*\.setup\.ts/, use: desktop(1440) },
    {
      name: "release-1440",
      testMatch: /(c\d\d-.*|honesty)\.spec\.ts/,
      testIgnore: /c15-smoke/,
      dependencies: ["setup"],
      use: desktop(1440),
    },
    {
      name: "release-375",
      testMatch: /(c\d\d-.*|honesty)\.spec\.ts/,
      testIgnore: /c15-smoke/,
      dependencies: ["setup"],
      use: touch(375),
    },
    {
      name: "smoke-240",
      testMatch: /c15-smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: touch(240),
    },
    {
      name: "smoke-768",
      testMatch: /c15-smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: desktop(768),
    },
    {
      name: "smoke-1024",
      testMatch: /c15-smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: desktop(1024),
    },
  ],
});
