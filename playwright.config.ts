import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
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
  },
});
