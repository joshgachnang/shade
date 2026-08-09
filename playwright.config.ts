import {defineConfig, devices} from "@playwright/test";

const isStatic = !!process.env.PLAYWRIGHT_STATIC;

// Dedicated e2e port. Multiple projects on this machine run Expo dev servers
// on 8082, and `reuseExistingServer` will happily attach to whichever app got
// there first — the suite then tests a different project's bundle entirely.
const PORT = Number(process.env.E2E_PORT ?? 8087);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: {timeout: 10000},
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
      },
      dependencies: ["setup"],
    },
  ],

  webServer: isStatic
    ? {
        // In CI, serve the pre-built SPA export to avoid Metro bundling delays.
        // --single enables SPA routing so all paths fall back to index.html.
        command: `bunx serve frontend/dist -p ${PORT} --single`,
        port: PORT,
        reuseExistingServer: false,
        timeout: 30000,
      }
    : {
        command: `cd frontend && bunx expo start --web --port ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
