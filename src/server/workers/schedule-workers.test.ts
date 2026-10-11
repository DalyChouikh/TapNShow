import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDispatch: vi.fn(async () => ({})),
  runSheetSync: vi.fn(async () => ({})),
  logError: vi.fn(),
  pending: [] as Promise<void>[],
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
  createDispatchDeps: () => ({}),
}));
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
});
