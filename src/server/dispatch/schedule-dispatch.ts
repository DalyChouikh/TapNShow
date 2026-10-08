import "server-only";
import { after } from "next/server";
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_BUDGET_MS,
  DISPATCH_LEASE_SECONDS,
  DISPATCH_PACE_MS,
} from "@/config/meetings";
import { logger } from "@/lib/logger";
import { createDispatchDeps } from "./dispatch-deps";
import { runDispatch } from "./run-dispatch";

/** The production run options. */
export const DISPATCH_OPTIONS = {
  budgetMs: DISPATCH_BUDGET_MS,
  paceMs: DISPATCH_PACE_MS,
  batchSize: DISPATCH_BATCH_SIZE,
  leaseSeconds: DISPATCH_LEASE_SECONDS,
};

/**
 * Starts a dispatcher run after the current response is sent (Next `after()`; it runs for the
 * route's `maxDuration`). Failures are logged, never thrown into the request.
 */
export function scheduleDispatch(): void {
  after(async () => {
    try {
      await runDispatch(createDispatchDeps(), DISPATCH_OPTIONS);
    } catch (error) {
      logger.error({ err: error }, "dispatch run failed");
    }
  });
}
