import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  scheduleWorkers: vi.fn<(which: ReadonlyArray<string>) => void>(),
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.scheduleWorkers,
}));
vi.mock("@/server/http/token-context", () => ({
  loadTokenContext: async () => ({
    ok: true,
    client: {},
    tokenHash: "h".repeat(64),
  }),
}));
vi.mock("@/server/queries/tokens", () => ({ unsubscribeToken: mocks.call }));

const ctx = { params: Promise.resolve({ token: "a".repeat(43) }) };
const post = () =>
  new Request("http://localhost:3000/api/r/x/report", { method: "POST" });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/r/[token]/report", () => {
  it("acts on the person behind the token, and 404s for an unknown one", async () => {
    mocks.call.mockResolvedValueOnce({ data: true, error: null });
    const { POST } = await import("./route");
    expect(await (await POST(post(), ctx)).json()).toEqual({ ok: true });
    expect(mocks.call).toHaveBeenCalledWith({}, "h".repeat(64), "report");
    mocks.call.mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(post(), ctx)).status).toBe(404);
  });

  it("starts the platform lane after a report (the admins hear within seconds), not after a 404", async () => {
    const { POST } = await import("./route");
    mocks.call.mockResolvedValueOnce({ data: false, error: null });
    await POST(post(), ctx);
    expect(mocks.scheduleWorkers).not.toHaveBeenCalled();
    mocks.call.mockResolvedValueOnce({ data: true, error: null });
    await POST(post(), ctx);
    expect(mocks.scheduleWorkers).toHaveBeenCalledExactlyOnceWith(["platform"]);
  });
});
