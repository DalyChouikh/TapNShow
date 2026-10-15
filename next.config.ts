import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  serviceWorkerHeaders,
  tokenPageHeaders,
} from "./src/config/security-headers";

const nextConfig: NextConfig = {
  headers: async () => [...tokenPageHeaders, ...serviceWorkerHeaders],
};
const withNextIntl = createNextIntlPlugin();

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  // Sentry's build step only uploads source maps and creates the release. Without a token (CI,
  // local builds, forks) it has nothing to do, so it skips the maps and reports nothing.
  silent: !sentryAuthToken,
  sourcemaps: { disable: !sentryAuthToken },
  widenClientFileUpload: true,
  telemetry: false,
});
