import * as Sentry from "@sentry/nextjs";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: getServerEnv().VERCEL_ENV ?? "development",
  }),
);
