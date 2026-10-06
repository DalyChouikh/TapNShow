import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { tokenPageHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  headers: async () => tokenPageHeaders,
};
const withNextIntl = createNextIntlPlugin();

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: false,
});
