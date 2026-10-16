import "server-only";
import { after } from "next/server";
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_BUDGET_MS,
  DISPATCH_LEASE_SECONDS,
  DISPATCH_PACE_MS,
} from "@/config/meetings";
import { getServerEnv } from "@/config/env";
import * as platform from "@/config/platform";
import { publicEnv } from "@/config/public-env";
import * as push from "@/config/push";
import * as sheets from "@/config/sheets";
import { logger } from "@/lib/logger";
import { createDispatchDeps } from "@/server/dispatch/dispatch-deps";
import { createPlatformDeps } from "@/server/platform/platform-deps";
import { runPlatformEvents } from "@/server/platform/run-platform-events";
import { runDispatch } from "@/server/dispatch/run-dispatch";
import { createPushDeps, pushConfigured } from "@/server/push/push-deps";
import { runPush } from "@/server/push/run-push";
import {
  recordWorkerFailure,
  type WorkerLane,
} from "@/server/queries/platform";
import { createSheetsDeps } from "@/server/sheets/sheets-deps";
import { runSheetSync } from "@/server/sheets/run-sheets";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** A background worker the internal route can start. */
export type Worker = "emails" | "sheets" | "platform";

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
  platform: {
    budgetMs: platform.PLATFORM_BUDGET_MS,
    batchSize: platform.PLATFORM_BATCH,
    leaseSeconds: platform.PLATFORM_LEASE_SECONDS,
  },
  push: {
    budgetMs: push.PUSH_BUDGET_MS,
    minLeftMs: push.PUSH_MIN_LEFT_MS,
    concurrency: push.PUSH_CONCURRENCY,
    leaseSeconds: push.PUSH_LEASE_SECONDS,
    idlePollMs: push.PUSH_IDLE_POLL_MS,
  },
} as const;

/**
 * Starts the named workers after the response is sent (Next `after()`), side by side, each with its
 * own budget; one failing, even while being built, never stops another. "emails" brings the push
 * lane with it when reminders are configured: pushes follow emails (spec §8), so the lane keeps
 * looking while the email run lasts. A crashed lane is logged and recorded as a platform event
 * (at most once an hour per lane, spec §8 M9); nothing is thrown into the request.
 */
export function scheduleWorkers(
  which: ReadonlyArray<Worker> = ["emails", "sheets", "platform"],
): void {
  after(async () => {
    const runs: Array<{ lane: WorkerLane; run: Promise<object> }> = [];
    const start = (lane: WorkerLane, work: () => Promise<object>) =>
      runs.push({ lane, run: Promise.resolve().then(work) });
    if (which.includes("emails")) {
      let emailsRunning = true;
      start("emails", () =>
        runDispatch(createDispatchDeps(), WORKER_OPTIONS.emails).finally(() => {
          emailsRunning = false;
        }),
      );
      if (pushConfigured(getServerEnv(), publicEnv)) {
        start("push", () =>
          runPush(createPushDeps(), WORKER_OPTIONS.push, {
            running: () => emailsRunning,
          }),
        );
      }
    }
    if (which.includes("sheets")) {
      start("sheets", () =>
        runSheetSync(createSheetsDeps(), WORKER_OPTIONS.sheets),
      );
    }
    if (which.includes("platform")) {
      start("platform", () =>
        runPlatformEvents(createPlatformDeps(), WORKER_OPTIONS.platform),
      );
    }
    const results = await Promise.allSettled(runs.map(({ run }) => run));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const { lane } = runs[index];
        logger.error({ err: result.reason, lane }, "worker run failed");
        await recordWorkerFailure(createSupabaseAdminClient(), lane).catch(
          (error: Error) =>
            logger.error(
              { err: error, lane },
              "could not record the failing worker",
            ),
        );
      }
    }
  });
}
