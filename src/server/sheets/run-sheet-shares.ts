import "server-only";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { logger } from "@/lib/logger";
import { planShareChanges, type ShareTarget } from "@/lib/sheets/share-plan";
import { budgetedGoogle, type Late } from "@/server/google/budgeted-call";
import type { DrivePermissionsClient } from "@/server/google/drive-permissions";
import type { GoogleFailure } from "@/server/google/google-call";
import type { RefreshResult } from "@/server/google/google-oauth";
import type { ReleasedConnection } from "@/server/google/release";
import type {
  CleanupClaim,
  ShareAccessAlert,
  ShareClaim,
  ShareStore,
} from "@/server/queries/sheet-shares";
import type { SheetPausedAlert } from "@/server/queries/sheets";
import type { SheetPauseReason } from "@/shared/api/sheets";

/** What the share steps need from the outside world (injected, so tests use fakes). */
export type SheetSharesDeps = {
  store: ShareStore;
  drive: DrivePermissionsClient;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  revoke: (released: ReleasedConnection[]) => Promise<void>;
  alertPaused: (alert: SheetPausedAlert) => Promise<void>;
  alertAccessLeft: (alert: ShareAccessAlert) => Promise<void>;
  reportBug: (context: {
    where: string;
    status: number;
    reason: string;
  }) => void;
  now: () => number;
  newRunId: () => string;
};

/** One run's limits (`WORKER_OPTIONS.sheets` plus the lane's start, so the steps share one budget). */
export type SheetSharesOptions = {
  startedAt: number;
  budgetMs: number;
  minLeftMs: number;
  batchSize: number;
  leaseSeconds: number;
  sharesPerRun: number;
  refusedRetryMs: number;
  cleanupBatch: number;
};

/** What a share run did (logged as counts only). */
export type SheetSharesSummary = {
  sheets: number;
  created: number;
  adopted: number;
  removed: number;
  refused: number;
  retried: number;
  paused: number;
};

/** What a cleanup run did (logged as counts only). */
export type ShareCleanupsSummary = {
  cleanups: number;
  removed: number;
  finished: number;
  gaveUp: number;
  retried: number;
};

/** A token for a run, or why there is none (`invalid_grant` = access lost for good). */
async function accessToken(
  deps: SheetSharesDeps,
  refreshToken: string,
): Promise<
  { kind: "ok"; token: string } | { kind: "lost" } | { kind: "retry" }
> {
  const refreshed = await deps.refresh(refreshToken);
  if (refreshed.kind === "ok") {
    return { kind: "ok", token: refreshed.accessToken };
  }
  return refreshed.kind === "invalid_grant"
    ? { kind: "lost" }
    : { kind: "retry" };
}

/**
 * Brings every due sheet's shares in line with its team (design §5): one `permissions.list`, then
 * the planner's actions, the intent always written before `permissions.create`. A refusal marks
 * that person only; a rate limit or 5xx backs off the sheet's shares; lost access or a gone file
 * pauses the sheet like the redraw does. Never throws for one sheet.
 */
export async function runSheetShares(
  deps: SheetSharesDeps,
  options: SheetSharesOptions,
): Promise<SheetSharesSummary> {
  const run = deps.newRunId();
  const summary: SheetSharesSummary = {
    sheets: 0,
    created: 0,
    adopted: 0,
    removed: 0,
    refused: 0,
    retried: 0,
    paused: 0,
  };
  const canCall = () =>
    options.budgetMs - (deps.now() - options.startedAt) >= options.minLeftMs;
  while (canCall()) {
    const claims = await deps.store.claim(
      run,
      options.batchSize,
      options.leaseSeconds,
    );
    if (claims.length === 0) {
      break;
    }
    for (const claim of claims) {
      summary.sheets += 1;
      try {
        await shareSheet(deps, options, run, claim, canCall, summary);
      } catch (error) {
        logger.error({ err: error }, "sheet share failed");
        await deps.store.retry(claim.workspaceId, run).catch(() => undefined);
        summary.retried += 1;
      }
    }
  }
  logger.info({ summary }, "share run finished");
  return summary;
}

async function shareSheet(
  deps: SheetSharesDeps,
  options: SheetSharesOptions,
  run: string,
  claim: ShareClaim,
  canCall: () => boolean,
  summary: SheetSharesSummary,
): Promise<void> {
  const workspace = claim.workspaceId;
  const file = claim.spreadsheetId;
  const pause = async (reason: SheetPauseReason) => {
    summary.paused += 1;
    const alert = await deps.store.pause(workspace, run, reason);
    if (alert) {
      await deps
        .alertPaused(alert)
        .catch((error: Error) =>
          logger.error({ err: error }, "sheet-paused alert failed"),
        );
    }
  };
  const later = () =>
    deps.store.release(
      workspace,
      run,
      claim.version,
      new Date(deps.now()).toISOString(),
    );
  const fail = async (failure: GoogleFailure | Late, where: string) => {
    if (failure.kind === "late") {
      return later();
    }
    if (failure.kind === "access_lost" || failure.kind === "unauthorized") {
      return pause("access_lost");
    }
    if (failure.kind === "not_found") {
      return pause("deleted");
    }
    if (failure.kind === "bug") {
      deps.reportBug({ where, status: failure.status, reason: failure.reason });
    }
    summary.retried += 1;
    return deps.store.retry(workspace, run);
  };
  const connection = claim.connection;
  if (!connection || !connection.scopes.includes(DRIVE_FILE_SCOPE)) {
    return pause("access_lost");
  }
  const refreshToken = deps.openToken(
    connection.tokenEncrypted,
    connection.userId,
    connection.googleSub,
  );
  let token = "";
  const refresh = async (): Promise<"ok" | "stop"> => {
    const got = await accessToken(deps, refreshToken);
    if (got.kind === "ok") {
      token = got.token;
      return "ok";
    }
    if (got.kind === "lost") {
      await pause("access_lost");
    } else {
      summary.retried += 1;
      await deps.store.retry(workspace, run);
    }
    return "stop";
  };
  if (!canCall()) {
    return later();
  }
  if ((await refresh()) === "stop") {
    return;
  }
  const google = budgetedGoogle({ canCall, refresh, token: () => token });

  const listed = await google((t) => deps.drive.list(t, file));
  if (listed.kind !== "ok") {
    return fail(listed, "share-list");
  }
  const plan = planShareChanges({
    targets: claim.targets,
    shares: claim.shares,
    permissions: listed.value,
    cap: claim.cap,
    now: deps.now(),
    createBudget: options.sharesPerRun,
  });
  const save = (
    target: ShareTarget,
    outcome: {
      state: "shared" | "external" | "refused";
      permissionId?: string;
      reason?: "refused" | "too_many" | "removed_in_drive";
      nextTryAt?: string;
    },
  ) =>
    deps.store.save(workspace, run, {
      email: target.email,
      userId: target.userId,
      state: outcome.state,
      permissionId: outcome.permissionId ?? null,
      reason: outcome.reason ?? null,
      nextTryAt: outcome.nextTryAt ?? null,
    });

  if (
    plan.forget.length > 0 &&
    !(await deps.store.forget(workspace, run, plan.forget))
  ) {
    return;
  }
  for (const removal of plan.remove) {
    const removed = await google((t) =>
      deps.drive.remove(t, file, removal.permissionId),
    );
    if (removed.kind !== "ok") {
      return fail(removed, "share-remove");
    }
    summary.removed += 1;
    if (!(await deps.store.forget(workspace, run, [removal.email]))) {
      return;
    }
  }
  const recorded = [
    ...plan.adopt.map(
      ({ target, permissionId }) =>
        () =>
          save(target, { state: "shared", permissionId }),
    ),
    ...plan.external.map((target) => () => save(target, { state: "external" })),
    ...plan.removedInDrive.map(
      (target) => () =>
        save(target, { state: "refused", reason: "removed_in_drive" }),
    ),
    ...plan.tooMany.map(
      (target) => () => save(target, { state: "refused", reason: "too_many" }),
    ),
  ];
  for (const record of recorded) {
    if (!(await record())) {
      return;
    }
  }
  summary.adopted += plan.adopt.length;
  for (const target of plan.create) {
    // No intent without the time for the call it announces.
    if (!canCall()) {
      return later();
    }
    if (!(await deps.store.intend(workspace, run, target))) {
      return;
    }
    const created = await google((t) =>
      deps.drive.create(t, file, target.email),
    );
    if (created.kind === "refused") {
      summary.refused += 1;
      if (
        !(await save(target, {
          state: "refused",
          reason: "refused",
          nextTryAt: new Date(
            deps.now() + options.refusedRetryMs,
          ).toISOString(),
        }))
      ) {
        return;
      }
      continue;
    }
    if (created.kind !== "ok") {
      // The row stays `sharing`: the next run lists first and adopts a share Google did make.
      return fail(created, "share-create");
    }
    summary.created += 1;
    if (
      !(await save(target, { state: "shared", permissionId: created.value }))
    ) {
      return;
    }
  }
  await deps.store.release(workspace, run, claim.version, plan.nextDue);
}

/**
 * Removes the access TapNShow gave on files it let go of (design §5), then releases and revokes
 * the held Google account and tells the Owner when people may still have access. Retries with
 * backoff until the cleanup's `giveUpAt`, then finishes with what is left. Never throws for one.
 */
export async function runShareCleanups(
  deps: SheetSharesDeps,
  options: SheetSharesOptions,
): Promise<ShareCleanupsSummary> {
  const run = deps.newRunId();
  const summary: ShareCleanupsSummary = {
    cleanups: 0,
    removed: 0,
    finished: 0,
    gaveUp: 0,
    retried: 0,
  };
  const canCall = () =>
    options.budgetMs - (deps.now() - options.startedAt) >= options.minLeftMs;
  while (canCall()) {
    const cleanups = await deps.store.cleanupClaim(
      run,
      options.cleanupBatch,
      options.leaseSeconds,
    );
    if (cleanups.length === 0) {
      break;
    }
    for (const cleanup of cleanups) {
      summary.cleanups += 1;
      try {
        await cleanFile(deps, run, cleanup, canCall, summary);
      } catch (error) {
        logger.error({ err: error }, "share cleanup failed");
        await deps.store.cleanupRetry(cleanup.id, run).catch(() => undefined);
        summary.retried += 1;
      }
    }
  }
  logger.info({ summary }, "share cleanup run finished");
  return summary;
}

async function cleanFile(
  deps: SheetSharesDeps,
  run: string,
  cleanup: CleanupClaim,
  canCall: () => boolean,
  summary: ShareCleanupsSummary,
): Promise<void> {
  const givingUp = deps.now() >= Date.parse(cleanup.giveUpAt);
  const most = cleanup.permissionIds.length + cleanup.emails.length;
  const finish = async (left: number) => {
    const done = await deps.store.cleanupFinish(cleanup.id, run, left);
    if (!done) {
      return;
    }
    summary.finished += 1;
    if (left > 0) {
      summary.gaveUp += 1;
    }
    if (done.released) {
      await deps.revoke([done.released]);
    }
    if (done.alert) {
      await deps
        .alertAccessLeft(done.alert)
        .catch((error: Error) =>
          logger.error({ err: error }, "access-left alert failed"),
        );
    }
  };
  const retryOrGiveUp = async (left: number) => {
    if (givingUp) {
      return finish(left);
    }
    summary.retried += 1;
    return deps.store.cleanupRetry(cleanup.id, run);
  };
  const refreshToken = deps.openToken(
    cleanup.tokenEncrypted,
    cleanup.tokenUserId,
    cleanup.googleSub,
  );
  let token = "";
  let lost = false;
  const refresh = async (): Promise<"ok" | "stop"> => {
    const got = await accessToken(deps, refreshToken);
    if (got.kind === "ok") {
      token = got.token;
      return "ok";
    }
    lost = got.kind === "lost";
    return "stop";
  };
  if (!canCall()) {
    return deps.store.cleanupRetry(cleanup.id, run);
  }
  if ((await refresh()) === "stop") {
    return lost ? finish(most) : retryOrGiveUp(most);
  }
  const google = budgetedGoogle({ canCall, refresh, token: () => token });
  const listed = await google((t) => deps.drive.list(t, cleanup.spreadsheetId));
  if (listed.kind === "late") {
    return deps.store.cleanupRetry(cleanup.id, run);
  }
  if (listed.kind === "not_found") {
    return finish(0);
  }
  if (listed.kind !== "ok") {
    if (listed.kind === "bug") {
      deps.reportBug({
        where: "cleanup-list",
        status: listed.status,
        reason: listed.reason,
      });
    }
    return listed.kind === "access_lost" || listed.kind === "unauthorized"
      ? finish(most)
      : retryOrGiveUp(most);
  }
  const held = new Set(cleanup.permissionIds);
  const inFlight = new Set(cleanup.emails.map((email) => email.toLowerCase()));
  const toRemove = listed.value
    .filter(
      (permission) => held.has(permission.id) || inFlight.has(permission.email),
    )
    .map((permission) => permission.id);
  let left = toRemove.length;
  for (const permissionId of toRemove) {
    const removed = await google((t) =>
      deps.drive.remove(t, cleanup.spreadsheetId, permissionId),
    );
    if (removed.kind === "late") {
      return deps.store.cleanupRetry(cleanup.id, run);
    }
    if (removed.kind !== "ok") {
      return removed.kind === "access_lost" || removed.kind === "unauthorized"
        ? finish(left)
        : retryOrGiveUp(left);
    }
    summary.removed += 1;
    left -= 1;
  }
  return finish(0);
}
