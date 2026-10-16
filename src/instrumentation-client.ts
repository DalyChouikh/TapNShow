// First: Zod must be jitless before any module below parses at import time.
import "@/lib/zod-jitless";
import { publicEnv } from "@/config/public-env";
import { browserSentry } from "@/lib/observability/browser-sentry";

browserSentry.start({
  enabled: Boolean(publicEnv.NEXT_PUBLIC_SENTRY_DSN),
  load: () =>
    import("@/lib/observability/browser-sentry-sdk").then((sdk) =>
      sdk.initBrowserSentry(),
    ),
});

/** Lets Sentry trace client-side navigations (once the SDK has loaded). */
export const onRouterTransitionStart = browserSentry.onRouterTransitionStart;
