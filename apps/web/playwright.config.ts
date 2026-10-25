import { defineConfig, devices } from "@playwright/test";

const WIDTHS = [240, 320, 375, 768, 1024, 1440] as const;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://localhost:3000",
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
    command: "node ./node_modules/next/dist/bin/next start -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { API_URL: process.env.API_URL ?? "http://127.0.0.1:4999" },
  },
});
