import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDispatch: vi.fn(async () => ({})),
  runSheetSync: vi.fn(async () => ({})),
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
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, info: vi.fn(), warn: vi.fn() },
}));

const { scheduleWorkers } = await import("./schedule-workers");
const settle = () => Promise.all(mocks.pending);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = [];
  mocks.configured = true;
});

describe("scheduleWorkers", () => {
  it("runs both workers by default", async () => {
    scheduleWorkers();
    await settle();
    expect(mocks.runDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.runSheetSync).toHaveBeenCalledTimes(1);
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
