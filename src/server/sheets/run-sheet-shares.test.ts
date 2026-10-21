import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import type { DrivePermission, ShareRow } from "@/lib/sheets/share-plan";
import { logger } from "@/lib/logger";
import type { DrivePermissionsClient } from "@/server/google/drive-permissions";
import type { GoogleFailure } from "@/server/google/google-call";
import type { ReleasedConnection } from "@/server/google/release";
import type {
  CleanupClaim,
  ShareAccessAlert,
  ShareClaim,
  ShareStore,
} from "@/server/queries/sheet-shares";
import type { SheetPausedAlert } from "@/server/queries/sheets";
import {
  runSheetShares,
  runShareCleanups,
  type SheetSharesDeps,
  type SheetSharesOptions,
} from "./run-sheet-shares";

const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const OPTIONS: SheetSharesOptions = {
  startedAt: NOW,
  budgetMs: 50_000,
  minLeftMs: 20_000,
  batchSize: 5,
  leaseSeconds: 120,
  sharesPerRun: 25,
  refusedRetryMs: 86_400_000,
  cleanupBatch: 5,
};
const SARA = { userId: "u-sara", email: "sara@example.test", position: 1 };
const ALI = { userId: "u-ali", email: "ali@example.test", position: 2 };
const RELEASED: ReleasedConnection = {
  tokenEncrypted: "sealed",
  googleSub: "sub",
  userId: "u-owner",
};

const claimOf = (over: Partial<ShareClaim> = {}): ShareClaim => ({
  workspaceId: "w1",
  spreadsheetId: "file-000001",
  version: 3,
  cap: 500,
  connection: {
    id: "c1",
    userId: "u-owner",
    googleSub: "sub",
    tokenEncrypted: "sealed",
    scopes: ["openid", "email", DRIVE_FILE_SCOPE],
  },
  targets: [SARA],
  shares: [],
  ...over,
});
const cleanupOf = (over: Partial<CleanupClaim> = {}): CleanupClaim => ({
  id: "k1",
  spreadsheetId: "file-000001",
  googleSub: "sub",
  tokenUserId: "u-owner",
  tokenEncrypted: "sealed",
  permissionIds: [],
  emails: [],
  giveUpAt: new Date(NOW + 3_600_000).toISOString(),
  ...over,
});

/** A store over one claim; records every call in order. */
function fakeStore(input: {
  claims?: ShareClaim[];
  cleanups?: CleanupClaim[];
  finish?: {
    released: ReleasedConnection | null;
    alert: ShareAccessAlert | null;
  };
}) {
  const calls: string[] = [];
  const saved: Array<{
    email: string;
    userId: string | null;
    state: string;
    permissionId: string | null;
    reason: string | null;
    nextTryAt: string | null;
  }> = [];
  let claims = [...(input.claims ?? [])];
  let cleanups = [...(input.cleanups ?? [])];
  const store: ShareStore = {
    claim: async () => {
      const out = claims;
      claims = [];
      return out;
    },
    intend: async (_w, _r, target) => {
      calls.push(`intend:${target.email}`);
      return true;
    },
    save: async (_w, _r, row) => {
      calls.push(`save:${row.email}:${row.state}`);
      saved.push(row);
      return true;
    },
    forget: async (_w, _r, emails) => {
      calls.push(`forget:${emails.join(",")}`);
      return true;
    },
    release: async (_w, _r, version, nextDue) => {
      calls.push(`release:${version}:${nextDue ?? "none"}`);
    },
    retry: async () => {
      calls.push("retry");
    },
    pause: async (_w, _r, reason) => {
      calls.push(`pause:${reason}`);
      return {
        email: "owner@example.test",
        workspaceName: "Robotics Club",
        workspaceSlug: "robotics",
        reason,
      };
    },
    cleanupClaim: async () => {
      const out = cleanups;
      cleanups = [];
      return out;
    },
    cleanupRetry: async (_id, _run, backoff) => {
      calls.push(backoff ? "cleanup-retry" : "cleanup-later");
    },
    cleanupFinish: async (_id, _run, left) => {
      calls.push(`cleanup-finish:${left}`);
      return input.finish ?? { released: RELEASED, alert: null };
    },
  };
  return { store, calls, saved };
}

/** A file's permissions in memory; `fail` queues a failure for the next call of one method. */
function fakeDrive(initial: DrivePermission[] = [], refuse: string[] = []) {
  const people = new Map(initial.map((p) => [p.email, p.id]));
  const calls: string[] = [];
  const failures: Partial<
    Record<keyof DrivePermissionsClient, GoogleFailure[]>
  > = {};
  let ids = 0;
  const drive: DrivePermissionsClient = {
    list: async () => {
      calls.push("list");
      const failure = failures.list?.shift();
      return (
        failure ?? {
          kind: "ok",
          value: [...people].map(([email, id]) => ({ id, email })),
        }
      );
    },
    create: async (_t, _f, email) => {
      calls.push(`create:${email}`);
      const failure = failures.create?.shift();
      if (failure) {
        return failure;
      }
      if (refuse.includes(email)) {
        return { kind: "refused", unexpected: null };
      }
      const id = `p${(ids += 1)}`;
      people.set(email, id);
      return { kind: "ok", value: id };
    },
    remove: async (_t, _f, permissionId) => {
      calls.push(`remove:${permissionId}`);
      const failure = failures.remove?.shift();
      if (failure) {
        return failure;
      }
      for (const [email, id] of people) {
        if (id === permissionId) {
          people.delete(email);
        }
      }
      return { kind: "ok", value: null };
    },
  };
  return { drive, calls, people, failures };
}

function depsOf(
  store: ShareStore,
  drive: DrivePermissionsClient,
  over: Partial<SheetSharesDeps> = {},
) {
  const alerts: {
    paused: SheetPausedAlert[];
    left: ShareAccessAlert[];
    revoked: ReleasedConnection[];
  } = {
    paused: [],
    left: [],
    revoked: [],
  };
  const deps: SheetSharesDeps = {
    store,
    drive,
    refresh: async () => ({ kind: "ok", accessToken: "token" }),
    openToken: () => "refresh",
    revoke: async (released) => {
      alerts.revoked.push(...released);
    },
    alertPaused: async (alert) => {
      alerts.paused.push(alert);
    },
    alertAccessLeft: async (alert) => {
      alerts.left.push(alert);
    },
    reportBug: () => undefined,
    now: () => NOW,
    newRunId: () => "run-1",
    ...over,
  };
  return { deps, alerts };
}

afterEach(() => vi.restoreAllMocks());

describe("runSheetShares", () => {
  it("shares with a new Viewer, writing the intent first", async () => {
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive } = fakeDrive();
    const { deps } = depsOf(store, drive);
    const summary = await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual([
      `intend:${SARA.email}`,
      `save:${SARA.email}:shared`,
      "release:3:none",
    ]);
    expect(summary).toMatchObject({ sheets: 1, created: 1 });
  });

  it("adopts a share a crashed run made instead of sharing again", async () => {
    const claim = claimOf({
      shares: [
        {
          email: SARA.email,
          state: "sharing",
          permissionId: null,
          reason: null,
          nextTryAt: null,
        },
      ],
    });
    const { store, saved } = fakeStore({ claims: [claim] });
    const { drive, calls } = fakeDrive([{ id: "p7", email: SARA.email }]);
    const { deps } = depsOf(store, drive);
    await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual(["list"]);
    expect(saved).toEqual([
      {
        email: SARA.email,
        userId: SARA.userId,
        state: "shared",
        permissionId: "p7",
        reason: null,
        nextTryAt: null,
      },
    ]);
  });

  it("removes the share of someone who left, then forgets them", async () => {
    const left: ShareRow = {
      email: ALI.email,
      state: "shared",
      permissionId: "p1",
      reason: null,
      nextTryAt: null,
    };
    const { store, calls } = fakeStore({
      claims: [claimOf({ targets: [], shares: [left] })],
    });
    const { drive, calls: driveCalls } = fakeDrive([
      { id: "p1", email: ALI.email },
    ]);
    const { deps } = depsOf(store, drive);
    await runSheetShares(deps, OPTIONS);
    expect(driveCalls).toEqual(["list", "remove:p1"]);
    expect(calls).toEqual([`forget:${ALI.email}`, "release:3:none"]);
  });

  it("marks one refusal without pausing the sheet", async () => {
    const { store, calls, saved } = fakeStore({
      claims: [claimOf({ targets: [SARA, ALI] })],
    });
    const { drive } = fakeDrive([], [SARA.email]);
    const { deps, alerts } = depsOf(store, drive);
    const summary = await runSheetShares(deps, OPTIONS);
    expect(saved.find((row) => row.email === SARA.email)).toEqual({
      email: SARA.email,
      userId: SARA.userId,
      state: "refused",
      permissionId: null,
      reason: "refused",
      nextTryAt: new Date(NOW + OPTIONS.refusedRetryMs).toISOString(),
    });
    expect(saved.find((row) => row.email === ALI.email)?.state).toBe("shared");
    // The sheet comes back when the refusal's next try is due.
    expect(calls.at(-1)).toBe(
      `release:3:${new Date(NOW + OPTIONS.refusedRetryMs).toISOString()}`,
    );
    expect(alerts.paused).toEqual([]);
    expect(summary).toMatchObject({ refused: 1, created: 1 });
  });

  it("reports a refusal outside Drive's known ones, and still marks only that person", async () => {
    const { store, saved } = fakeStore({ claims: [claimOf()] });
    const { drive } = fakeDrive();
    drive.create = async () => ({
      kind: "refused",
      unexpected: { status: 409, reason: "conflict" },
    });
    const reportBug = vi.fn<SheetSharesDeps["reportBug"]>();
    const { deps, alerts } = depsOf(store, drive, { reportBug });
    await runSheetShares(deps, OPTIONS);
    expect(reportBug).toHaveBeenCalledExactlyOnceWith({
      where: "share-create",
      status: 409,
      reason: "conflict",
    });
    expect(saved.map((row) => row.state)).toEqual(["refused"]);
    expect(alerts.paused).toEqual([]);
  });

  it("only backs off, never pauses, when a token refresh fails for a moment", async () => {
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "unauthorized" }];
    const refresh = vi
      .fn<SheetSharesDeps["refresh"]>()
      .mockResolvedValueOnce({ kind: "ok", accessToken: "token" })
      .mockResolvedValueOnce({ kind: "error", status: 503 });
    const { deps, alerts } = depsOf(store, drive, { refresh });
    await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual(["retry"]);
    expect(alerts.paused).toEqual([]);
  });

  it("backs off the sheet's shares on a rate limit", async () => {
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive, failures } = fakeDrive();
    failures.create = [{ kind: "retry", status: 403 }];
    const { deps } = depsOf(store, drive);
    await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual([`intend:${SARA.email}`, "retry"]);
  });

  it("pauses the sheet when Google access is lost", async () => {
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive } = fakeDrive();
    const { deps, alerts } = depsOf(store, drive, {
      refresh: async () => ({ kind: "invalid_grant" }),
    });
    await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual(["pause:access_lost"]);
    expect(alerts.paused).toHaveLength(1);
  });

  it("pauses the sheet when its file is gone", async () => {
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "not_found" }];
    const { deps } = depsOf(store, drive);
    await runSheetShares(deps, OPTIONS);
    expect(calls).toEqual(["pause:deleted"]);
  });

  it("stops calling Google when the budget is spent and leaves the sheet due", async () => {
    let now = NOW;
    const { store, calls } = fakeStore({ claims: [claimOf()] });
    const { drive, calls: driveCalls } = fakeDrive();
    drive.list = async () => {
      driveCalls.push("list");
      now = NOW + 40_000;
      return { kind: "ok", value: [] };
    };
    const { deps } = depsOf(store, drive, { now: () => now });
    await runSheetShares(deps, OPTIONS);
    expect(driveCalls).toEqual(["list"]);
    expect(calls).toEqual([
      `release:3:${new Date(NOW + 40_000).toISOString()}`,
    ]);
  });

  it("never logs an address", async () => {
    const spies = [
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
    ];
    const { store } = fakeStore({
      claims: [claimOf({ targets: [SARA, ALI] })],
    });
    const { drive, failures } = fakeDrive([], [SARA.email]);
    failures.create = [{ kind: "bug", status: 400, reason: "badRequest" }];
    const { deps } = depsOf(store, drive);
    await runSheetShares(deps, OPTIONS);
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("@");
  });
});

describe("runShareCleanups", () => {
  it("removes the old file's shares, then releases and revokes", async () => {
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1"], emails: [SARA.email] })],
    });
    const { drive, calls: driveCalls } = fakeDrive([
      { id: "p1", email: ALI.email },
      { id: "p2", email: SARA.email },
    ]);
    const { deps, alerts } = depsOf(store, drive);
    const summary = await runShareCleanups(deps, OPTIONS);
    expect(driveCalls).toEqual(["list", "remove:p1", "remove:p2"]);
    expect(calls).toEqual(["cleanup-finish:0"]);
    expect(alerts.revoked).toEqual([RELEASED]);
    expect(summary).toMatchObject({ cleanups: 1, removed: 2, finished: 1 });
  });

  it("treats a deleted file as nothing left to remove", async () => {
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1"] })],
    });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "not_found" }];
    const { deps } = depsOf(store, drive);
    await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-finish:0"]);
  });

  it("retries a cleanup after a Google error while there is time", async () => {
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1"] })],
    });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "retry", status: 503 }];
    const { deps } = depsOf(store, drive);
    await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-retry"]);
  });

  it("gives up after give_up_at, revokes anyway and emails the Owner the count", async () => {
    const alert: ShareAccessAlert = {
      email: "owner@example.test",
      workspaceName: "Robotics Club",
      spreadsheetId: "file-000001",
      accountEmail: "club@example.test",
      left: 2,
    };
    const { store, calls } = fakeStore({
      cleanups: [
        cleanupOf({
          permissionIds: ["p1"],
          emails: [SARA.email],
          giveUpAt: new Date(NOW - 1).toISOString(),
        }),
      ],
      finish: { released: RELEASED, alert },
    });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "retry", status: 503 }];
    const { deps, alerts } = depsOf(store, drive);
    const summary = await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-finish:2"]);
    expect(alerts.revoked).toEqual([RELEASED]);
    expect(alerts.left).toEqual([alert]);
    expect(summary).toMatchObject({ gaveUp: 1 });
  });

  it("tries a cleanup again when a token refresh fails for a moment", async () => {
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1"] })],
    });
    const { drive, failures } = fakeDrive();
    failures.list = [{ kind: "unauthorized" }];
    const refresh = vi
      .fn<SheetSharesDeps["refresh"]>()
      .mockResolvedValueOnce({ kind: "ok", accessToken: "token" })
      .mockResolvedValueOnce({ kind: "error", status: 503 });
    const { deps } = depsOf(store, drive, { refresh });
    await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-retry"]);
  });

  it("waits for the next run without a backoff when only the time ran out", async () => {
    let now = NOW;
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1"] })],
    });
    const claim = store.cleanupClaim;
    store.cleanupClaim = async (...args) => {
      const out = await claim(...args);
      now = NOW + 40_000;
      return out;
    };
    const { drive, calls: driveCalls } = fakeDrive();
    const { deps } = depsOf(store, drive, { now: () => now });
    await runShareCleanups(deps, OPTIONS);
    expect(driveCalls).toEqual([]);
    expect(calls).toEqual(["cleanup-later"]);
  });

  it("finishes a cleanup that keeps failing once give_up_at has passed", async () => {
    const { store, calls } = fakeStore({
      cleanups: [
        cleanupOf({
          permissionIds: ["p1"],
          emails: [SARA.email],
          giveUpAt: new Date(NOW - 1).toISOString(),
        }),
      ],
    });
    const { drive } = fakeDrive();
    const { deps, alerts } = depsOf(store, drive, {
      openToken: () => {
        throw new Error("the sealed copy can't be opened");
      },
    });
    await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-finish:2"]);
    expect(alerts.revoked).toEqual([RELEASED]);
  });

  it("finishes with everything left when Google access is gone", async () => {
    const { store, calls } = fakeStore({
      cleanups: [cleanupOf({ permissionIds: ["p1", "p2"] })],
    });
    const { drive } = fakeDrive();
    const { deps } = depsOf(store, drive, {
      refresh: async () => ({ kind: "invalid_grant" }),
    });
    await runShareCleanups(deps, OPTIONS);
    expect(calls).toEqual(["cleanup-finish:2"]);
  });
});
