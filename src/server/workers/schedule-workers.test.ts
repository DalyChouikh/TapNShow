import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDispatch: vi.fn(async () => ({})),
  runSheetSync: vi.fn(async () => ({})),
  order: [] as string[],
  runSheetShares: vi.fn<
    (
      deps: object,
      options: { startedAt: number; budgetMs: number },
    ) => Promise<object>
  >(async () => ({})),
  runShareCleanups: vi.fn<
    (
      deps: object,
      options: { startedAt: number; budgetMs: number },
    ) => Promise<object>
  >(async () => ({})),
  logError: vi.fn(),
  pending: [] as Promise<void>[],
  runPush: vi.fn<
    (
      deps: object,
      options: object,
      emails: { running: () => boolean },
    ) => Promise<object>
  >(async () => ({})),
  configured: true,
  dispatchDeps: vi.fn(() => ({})),
  runPlatformEvents: vi.fn<(deps: object, options: object) => Promise<object>>(
    async () => ({}),
  ),
  recordWorkerFailure: vi.fn<(client: object, lane: string) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    mocks.pending.push(task());
  },
}));
vi.mock("@/server/dispatch/run-dispatch", () => ({
  runDispatch: mocks.runDispatch,
}));
vi.mock("@/server/dispatch/dispatch-deps", () => ({
  createDispatchDeps: mocks.dispatchDeps,
}));
vi.mock("@/server/push/run-push", () => ({ runPush: mocks.runPush }));
vi.mock("@/server/push/push-deps", () => ({
  createPushDeps: () => ({}),
  pushConfigured: () => mocks.configured,
}));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({}) }));
vi.mock("@/server/sheets/run-sheets", () => ({
  runSheetSync: mocks.runSheetSync,
}));
vi.mock("@/server/sheets/sheets-deps", () => ({
  createSheetsDeps: () => ({}),
}));
vi.mock("@/server/sheets/run-sheet-shares", () => ({
  runSheetShares: mocks.runSheetShares,
  runShareCleanups: mocks.runShareCleanups,
}));
vi.mock("@/server/sheets/sheet-shares-deps", () => ({
  createSheetSharesDeps: () => ({}),
}));
vi.mock("@/server/platform/run-platform-events", () => ({
  runPlatformEvents: mocks.runPlatformEvents,
}));
vi.mock("@/server/platform/platform-deps", () => ({
  createPlatformDeps: () => ({}),
}));
vi.mock("@/server/queries/platform", () => ({
  recordWorkerFailure: mocks.recordWorkerFailure,
}));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({}),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, info: vi.fn(), warn: vi.fn() },
}));

const { scheduleWorkers } = await import("./schedule-workers");
const settle = () => Promise.all(mocks.pending);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = [];
  mocks.order = [];
  mocks.configured = true;
});

describe("scheduleWorkers", () => {
  it("runs the share steps after the redraw, in the sheets lane's one budget", async () => {
    mocks.runSheetSync.mockImplementationOnce(async () => {
      mocks.order.push("sync");
      return {};
    });
    mocks.runSheetShares.mockImplementationOnce(async () => {
      mocks.order.push("shares");
      return {};
    });
    mocks.runShareCleanups.mockImplementationOnce(async () => {
      mocks.order.push("cleanups");
      return {};
    });
    scheduleWorkers(["sheets"]);
    await settle();
    expect(mocks.order).toEqual(["sync", "shares", "cleanups"]);
    const [, shareOptions] = mocks.runSheetShares.mock.calls[0];
    const [, cleanupOptions] = mocks.runShareCleanups.mock.calls[0];
    expect(shareOptions.startedAt).toBe(cleanupOptions.startedAt);
    expect(shareOptions.budgetMs).toBe(cleanupOptions.budgetMs);
  });

  it("still shares and cleans up when the redraw throws, and records the lane once", async () => {
    mocks.runSheetSync.mockRejectedValueOnce(new Error("boom"));
    scheduleWorkers(["sheets"]);
    await settle();
    expect(mocks.runSheetShares).toHaveBeenCalledTimes(1);
    expect(mocks.runShareCleanups).toHaveBeenCalledTimes(1);
    expect(mocks.recordWorkerFailure).toHaveBeenCalledExactlyOnceWith(
      {},
      "sheets",
    );
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it("logs each failed step of the sheets lane once", async () => {
    mocks.runSheetSync.mockRejectedValueOnce(new Error("boom"));
    mocks.runShareCleanups.mockRejectedValueOnce(new Error("bang"));
    scheduleWorkers(["sheets"]);
    await settle();
    expect(mocks.runSheetShares).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledTimes(2);
    expect(mocks.recordWorkerFailure).toHaveBeenCalledTimes(1);
  });

  it("runs every worker by default (emails, sheets, platform events)", async () => {
    scheduleWorkers();
    await settle();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.runSheetSync).toHaveBeenCalledTimes(1);
    expect(mocks.runPlatformEvents).toHaveBeenCalledTimes(1);
  });

  it("records a crashed lane once, by name, and keeps the others going", async () => {
    mocks.runPlatformEvents.mockRejectedValueOnce(new Error("boom"));
    scheduleWorkers();
    await settle();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.recordWorkerFailure).toHaveBeenCalledExactlyOnceWith(
      {},
      "platform",
    );
  });

  it("logs, and does not throw, when the failure can't be recorded either", async () => {
    mocks.runSheetSync.mockRejectedValueOnce(new Error("boom"));
    mocks.recordWorkerFailure.mockRejectedValueOnce(new Error("db down"));
    scheduleWorkers(["sheets"]);
    await settle();
    expect(mocks.logError).toHaveBeenCalledTimes(2);
  });

  it("runs only the named worker", async () => {
    scheduleWorkers(["emails"]);
    await settle();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.runSheetSync).not.toHaveBeenCalled();
  });

  it("lets the dispatcher finish when the sheet run fails, and logs once", async () => {
    mocks.runSheetSync.mockRejectedValueOnce(new Error("boom"));
    scheduleWorkers();
    await settle();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it("starts the push lane with the emails, polling only while the email run lasts", async () => {
    let finishEmails = () => {};
    mocks.runDispatch.mockImplementationOnce(
      () => new Promise((resolve) => (finishEmails = () => resolve({}))),
    );
    scheduleWorkers(["emails"]);
    await vi.waitFor(() => expect(mocks.runPush).toHaveBeenCalledTimes(1));
    const emails = mocks.runPush.mock.calls[0][2];
    expect(emails.running()).toBe(true);
    finishEmails();
    await settle();
    expect(emails.running()).toBe(false);
  });

  it("starts no push lane for sheets alone, or when reminders aren't configured", async () => {
    scheduleWorkers(["sheets"]);
    await settle();
    expect(mocks.runPush).not.toHaveBeenCalled();
    mocks.configured = false;
    scheduleWorkers();
    await settle();
    expect(mocks.runPush).not.toHaveBeenCalled();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps the other workers going when building the email worker fails", async () => {
    mocks.dispatchDeps.mockImplementationOnce(() => {
      throw new Error("missing DISPATCH_SECRET");
    });
    scheduleWorkers();
    await settle();
    expect(mocks.runSheetSync).toHaveBeenCalledTimes(1);
    expect(mocks.runPush).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });
});
