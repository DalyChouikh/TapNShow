import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/server/http/token-context", () => ({
  loadTokenContext: async () => ({
    ok: true,
    client: {},
    tokenHash: "h".repeat(64),
  }),
}));
vi.mock("@/server/queries/tokens", () => ({ lookupToken: mocks.lookup }));

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

beforeEach(() => vi.clearAllMocks());

describe("GET /api/r/[token]", () => {
  it("returns only the public info, and 404 for an unknown token", async () => {
    mocks.lookup.mockResolvedValueOnce({ data: info, error: null });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost:3000/api/r/x"),
      ctx,
    );
    expect(await response.json()).toEqual(info);
    expect(mocks.lookup).toHaveBeenCalledWith({}, "h".repeat(64));
    mocks.lookup.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await GET(new Request("http://localhost:3000/api/r/x"), ctx)).status,
    ).toBe(404);
  });
});
