import * as Sentry from "@sentry/nextjs";
import { publicEnv } from "@/config/public-env";
import { buildSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(
  buildSentryOptions({
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: publicEnv.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  }),
);

/** Lets Sentry trace client-side navigations. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
