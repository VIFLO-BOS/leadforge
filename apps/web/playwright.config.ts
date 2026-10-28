import { defineConfig, devices } from "@playwright/test";

const WIDTHS = [240, 320, 375, 768, 1024, 1440] as const;

/**
 * Port of the production server under test. Defaults to 3000 so CI is unchanged; local agents
 * run with PLAYWRIGHT_PORT=3300 to stay clear of a developer's own `pnpm dev` on 3000 (and of
 * 3100, which another project uses on this machine). The server reuses whatever already listens
 * on the port, so confirm it serves LeadForge first.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The release suite (e2e/release) runs against a live stack with its own config:
  // playwright.release.config.ts, started by `pnpm e2e:release`.
  testIgnore: ["release/**"],
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: WIDTHS.map((width) => ({
    name: `w${width}`,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width, height: 800 },
      // Narrow widths are touch devices in practice.
      hasTouch: width < 768,
      isMobile: width < 768,
      deviceScaleFactor: 1,
    },
  })),
  webServer: {
    // Call the Next binary directly so a package-manager pre-run hook cannot block startup.
    command: `node ./node_modules/next/dist/bin/next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { API_URL: process.env.API_URL ?? "http://127.0.0.1:4999" },
  },
});
