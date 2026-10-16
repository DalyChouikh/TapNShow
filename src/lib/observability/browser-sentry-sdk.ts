// Named imports only: returning the namespace object would keep every export (Replay, Feedback…)
// in the chunk.
import {
  captureException,
  captureRouterTransitionStart,
  init,
} from "@sentry/nextjs";
import { publicEnv } from "@/config/public-env";
import type { BrowserSentry } from "./browser-sentry";
import { buildSentryOptions } from "./sentry-options";

/**
 * Initialises the browser SDK. Imported only through `browserSentry.start` (`import()`), so the SDK
 * is a chunk of its own, fetched after the page has loaded.
 */
export function initBrowserSentry(): BrowserSentry {
  init(
    buildSentryOptions({
      dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
      environment: publicEnv.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    }),
  );
  return { captureException, captureRouterTransitionStart };
}
