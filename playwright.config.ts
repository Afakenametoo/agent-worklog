import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    channel: "chrome",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:4178/api/health",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
