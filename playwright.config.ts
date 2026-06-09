import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8001/html",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "on",
  },
  webServer: {
    command: "python3 -m http.server 8001",
    url: "http://127.0.0.1:8001/html",
    cwd: ".",
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      PYTHONUNBUFFERED: "1",
    },
  },
});
