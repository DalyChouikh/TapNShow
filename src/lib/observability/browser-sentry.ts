import type * as SentrySdk from "@sentry/nextjs";

/** The two SDK calls the browser makes outside `Sentry.init`. */
export type BrowserSentry = Pick<
  typeof SentrySdk,
  "captureException" | "captureRouterTransitionStart"
>;

/** Whatever `Sentry.captureException` accepts (an Error, a rejection reason, a message). */
export type CapturedError = Parameters<BrowserSentry["captureException"]>[0];

/** Errors kept while the SDK loads; the first ones usually name the cause, later ones repeat it. */
export const EARLY_ERRORS_MAX = 20;

/** Longest wait for an idle moment after the load event before the SDK is fetched anyway. */
export const SENTRY_IDLE_TIMEOUT_MS = 3000;

type StartOptions = {
  /** False without a DSN (local dev, CI): nothing is downloaded or buffered. */
  enabled: boolean;
  /** Imports and initialises the SDK (a separate chunk). */
  load: () => Promise<BrowserSentry>;
};

/**
 * The browser's Sentry, loaded after the page instead of with it: the SDK is the largest script on
 * every page and the public pages' first paint must not wait for it (spec §5, Lighthouse ≥ 95).
 * Like Sentry's Loader Script, unhandled errors and rejections that happen before it is ready are
 * buffered (at most `EARLY_ERRORS_MAX`) and reported once it is; so are errors handed over by the
 * error boundaries. When the SDK can't load (blocked, offline) the buffer is dropped.
 */
export function createBrowserSentry() {
  let state: "waiting" | "loading" | "ready" | "off" = "waiting";
  let sdk: BrowserSentry | null = null;
  let buffer: CapturedError[] = [];

  const keep = (error: CapturedError) => {
    if (buffer.length < EARLY_ERRORS_MAX) buffer.push(error);
  };
  const onError = (event: ErrorEvent) => keep(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => keep(event.reason);
  const stopListening = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };

  const becomeReady = (loaded: BrowserSentry) => {
    // Sentry's own global handlers are installed by now; ours would report twice.
    stopListening();
    sdk = loaded;
    state = "ready";
    const early = buffer;
    buffer = [];
    for (const error of early) loaded.captureException(error);
  };
  const turnOff = () => {
    stopListening();
    buffer = [];
    state = "off";
  };

  return {
    /** Starts buffering and schedules the SDK for after the page's load event. Runs once. */
    start({ enabled, load }: StartOptions) {
      if (state !== "waiting") return;
      if (!enabled) {
        turnOff();
        return;
      }
      state = "loading";
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
      const fetchWhenIdle = () => {
        const run = () => load().then(becomeReady, turnOff);
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(run, { timeout: SENTRY_IDLE_TIMEOUT_MS });
        } else {
          setTimeout(run, 0);
        }
      };
      if (document.readyState === "complete") fetchWhenIdle();
      else window.addEventListener("load", fetchWhenIdle, { once: true });
    },
    /** Reports an error now, or once the SDK is ready. */
    captureError(error: CapturedError) {
      if (sdk) sdk.captureException(error);
      else if (state !== "off") keep(error);
    },
    /** Next's navigation hook; navigations before the SDK is ready aren't traced. */
    onRouterTransitionStart(href: string, navigationType: string) {
      sdk?.captureRouterTransitionStart(href, navigationType);
    },
    /** Whether the SDK is loaded and reporting. */
    isReady: () => state === "ready",
    /** Whether reporting is off (no DSN, or the SDK couldn't load). */
    isOff: () => state === "off",
    /** How many errors wait for the SDK. */
    bufferedCount: () => buffer.length,
  };
}

/** The page's one instance: `instrumentation-client.ts` starts it, the error boundaries report through it. */
export const browserSentry = createBrowserSentry();

/** Reports a client-side error to Sentry, now or once the SDK has loaded. */
export function captureClientError(error: CapturedError): void {
  browserSentry.captureError(error);
}
