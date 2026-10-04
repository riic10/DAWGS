import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/world",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
    launchOptions: { args: process.platform === "darwin" ? ["--use-angle=metal"] : [] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm --prefix web run preview -- --host 127.0.0.1 --port ${new URL(baseURL).port || 5173} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
