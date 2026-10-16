import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { parsePublicEnv } from "./src/config/public-env-schema";
import {
  noIndexHeaders,
  serviceWorkerCsp,
  serviceWorkerHeaders,
  staticSecurityHeaders,
  tokenPageHeaders,
} from "./src/config/security-headers";

// The browser reads the public env without Zod (`readPublicEnv`); its rules run here, so an invalid
// value fails the build instead of reaching a page.
parsePublicEnv(process.env);

const nextConfig: NextConfig = {
  // Later rules win for the same header: the token pages' no-referrer overrides the default.
  headers: async () => [
    ...staticSecurityHeaders,
    ...noIndexHeaders,
    ...tokenPageHeaders,
    ...serviceWorkerHeaders,
    serviceWorkerCsp,
  ],
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
  // Browser events go through our own origin (connect-src 'self'; spec §5). A fixed path: the
  // proxy matcher excludes it.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  telemetry: false,
});
