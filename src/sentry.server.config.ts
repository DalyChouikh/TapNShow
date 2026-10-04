import * as Sentry from "@sentry/nextjs";
import { publicEnv } from "@/config/public-env";
import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
  }),
);
