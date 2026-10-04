import * as Sentry from "@sentry/nextjs";

/** Registers server-side instrumentation (Node.js runtime only; Edge is not used). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

/** Reports errors thrown while handling requests. */
export const onRequestError = Sentry.captureRequestError;
