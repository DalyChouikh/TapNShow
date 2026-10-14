import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  submit: vi.fn(),
  calendar: vi.fn(),
  unsubscribe: vi.fn(),
  viewer: vi.fn(),
}));
vi.mock("@/server/http/token-context", () => ({
  loadTokenContext: async () => ({
    ok: true,
    client: {},
    tokenHash: "h".repeat(64),
  }),
}));
vi.mock("@/server/http/token-viewer", () => ({ tokenViewer: mocks.viewer }));
vi.mock("@/server/queries/tokens", () => ({
  lookupToken: mocks.lookup,
  submitAnswer: mocks.submit,
  requestCalendar: mocks.calendar,
  unsubscribeToken: mocks.unsubscribe,
}));

const ctx = { params: Promise.resolve({ token: "a".repeat(43) }) };
const info = {
  workspaceName: "Robotics Club",
  maskedEmail: "a•••@uni.tn",
  unsubscribed: false,
  reported: false,
  meeting: {
    title: "Weekly sync",
    startsAt: "2026-10-09T17:00:00.000Z",
    timezone: "Africa/Tunis",
    durationMinutes: 60,
    locationMode: "in_person",
    locationText: "Room B12",
    meetingUrl: "",
    status: "scheduled",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue("signed_out");
});

describe("GET /api/r/[token]", () => {
  it("returns only the public info, and 404 for an unknown token", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: info, error: null });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost:3000/api/r/x"),
      ctx,
    );
    expect(await response.json()).toEqual({ ...info, viewer: "signed_out" });
    expect(mocks.lookup).toHaveBeenCalledWith({}, "h".repeat(64));
    mocks.lookup.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await GET(new Request("http://localhost:3000/api/r/x"), ctx)).status,
    ).toBe(404);
    expect(mocks.viewer).toHaveBeenCalledOnce();
  });

  it("says who is looking, from the request's session (M8)", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: info, error: null });
    mocks.viewer.mockResolvedValueOnce("owner");
    const { GET } = await import("./route");
    const request = new Request("http://localhost:3000/api/r/x", {
      headers: { cookie: "sb-x-auth-token=1" },
    });
    const response = await GET(request, ctx);
    expect(await response.json()).toMatchObject({ viewer: "owner" });
    expect(mocks.viewer).toHaveBeenCalledWith(request, {}, "h".repeat(64));
  });

  it("never writes, even when opened from an answer button (Review Focus 1)", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: info, error: null });
    const { GET } = await import("./route");
    await GET(
      new Request("http://localhost:3000/api/r/x?choice=attending"),
      ctx,
    );
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.calendar).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
});
