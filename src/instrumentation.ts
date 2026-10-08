import * as Sentry from "@sentry/nextjs";

/**
 * Registers server-side instrumentation (Node.js runtime only; Edge is not used) and validates the
 * server env once at startup, so a missing or malformed variable fails the deploy instead of the
 * first request that needs it (#51).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@/config/env");
    getServerEnv();
    await import("./sentry.server.config");
  }
}

/** Reports errors thrown while handling requests. */
export const onRequestError = Sentry.captureRequestError;
