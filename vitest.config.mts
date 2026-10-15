import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server bundles; tests import server modules directly.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
    css: false,
    // Route tests import their route inside the first test; under a full parallel run that cold
    // import alone has passed the 5 s default (invites route, 5.5 s).
    testTimeout: 15_000,
    env: {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      SMTP_FROM: "no-reply@example.test",
      LOG_LEVEL: "silent",
    },
  },
});
