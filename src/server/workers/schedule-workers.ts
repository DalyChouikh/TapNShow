import "server-only";
import { after } from "next/server";
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_BUDGET_MS,
  DISPATCH_LEASE_SECONDS,
  DISPATCH_PACE_MS,
} from "@/config/meetings";
import * as sheets from "@/config/sheets";
import { logger } from "@/lib/logger";
import { createDispatchDeps } from "@/server/dispatch/dispatch-deps";
import { runDispatch } from "@/server/dispatch/run-dispatch";
import { createSheetsDeps } from "@/server/sheets/sheets-deps";
import { runSheetSync } from "@/server/sheets/run-sheets";

/** A background worker the internal route can start. */
export type Worker = "emails" | "sheets";

/** The production run options of each worker. */
export const WORKER_OPTIONS = {
  emails: {
    budgetMs: DISPATCH_BUDGET_MS,
    paceMs: DISPATCH_PACE_MS,
    batchSize: DISPATCH_BATCH_SIZE,
    leaseSeconds: DISPATCH_LEASE_SECONDS,
  },
  sheets: {
    budgetMs: sheets.SHEET_BUDGET_MS,
    minLeftMs: sheets.SHEET_MIN_LEFT_MS,
    batchSize: sheets.SHEET_CLAIM_BATCH,
    leaseSeconds: sheets.SHEET_LEASE_SECONDS,
    tabRowsMax: sheets.SHEET_TAB_ROWS_MAX,
    cellsMax: sheets.SHEET_CELLS_MAX,
    formatVersion: sheets.SHEET_FORMAT_VERSION,
  },
} as const;

/**
 * Starts the named workers after the response is sent (Next `after()`), side by side, each with its
 * own budget; one failing never stops the other. Failures are logged, never thrown into the request.
 */
export function scheduleWorkers(
  which: ReadonlyArray<Worker> = ["emails", "sheets"],
): void {
  after(async () => {
    const runs = which.map((worker) =>
      worker === "emails"
        ? runDispatch(createDispatchDeps(), WORKER_OPTIONS.emails)
        : runSheetSync(createSheetsDeps(), WORKER_OPTIONS.sheets),
    );
    for (const result of await Promise.allSettled(runs)) {
      if (result.status === "rejected") {
        logger.error({ err: result.reason }, "worker run failed");
      }
    }
  });
}
