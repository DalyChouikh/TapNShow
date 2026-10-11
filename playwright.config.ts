import { defineConfig, devices } from "@playwright/test";
import { FAKE_GOOGLE_URL } from "./e2e/helpers/fake-google";
import {
  E2E_DISPATCH_SECRET,
  E2E_INVITE_SECRET,
  E2E_TOKEN_KEY,
} from "./e2e/helpers/seed-sender";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    {
      name: "small-phone",
      use: { ...devices["iPhone SE"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: `bun run build && bun run start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Every Google call goes to the fake in e2e/helpers/fake-google.ts (test-only secrets).
    env: {
      ...process.env,
      GMAIL_API_BASE_URL: FAKE_GOOGLE_URL,
      GOOGLE_SHEETS_API_BASE_URL: FAKE_GOOGLE_URL,
      GOOGLE_DRIVE_API_BASE_URL: FAKE_GOOGLE_URL,
      GOOGLE_OAUTH_TOKEN_URL: `${FAKE_GOOGLE_URL}/token`,
      GOOGLE_OAUTH_REVOKE_URL: `${FAKE_GOOGLE_URL}/revoke`,
      GOOGLE_CLIENT_ID: "e2e-client",
      GOOGLE_CLIENT_SECRET: "e2e-secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: E2E_TOKEN_KEY,
      INVITE_TOKEN_SECRET: E2E_INVITE_SECRET,
      DISPATCH_SECRET: E2E_DISPATCH_SECRET,
    },
  },
});
