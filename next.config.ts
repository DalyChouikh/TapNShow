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

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: false,
});
