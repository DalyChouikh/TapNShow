import { beforeEach, describe, expect, it, vi } from "vitest";
import { tokenInfoFixture } from "@/test/fixtures/tokens";

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
const request = () => new Request("http://localhost:3000/api/r/x/ics");
const meeting = {
  ...tokenInfoFixture.meeting,
  title: "Weekly sync",
  startsAt: "2026-10-09T17:00:00.000Z",
  durationMinutes: 60,
  status: "scheduled" as const,
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/r/[token]/ics", () => {
  it("returns a calendar file for the meeting, without the personal link", async () => {
    mocks.lookup.mockResolvedValueOnce({
      data: { ...tokenInfoFixture, meeting },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="weekly-sync.ics"',
    );
    const body = await response.text();
    expect(body).toContain("METHOD:PUBLISH");
    expect(body).toContain("SUMMARY:Weekly sync");
    expect(body).toContain("DTSTART:20261009T170000Z");
    expect(body).not.toContain("a".repeat(43));
    expect(body).not.toContain("/r/");
  });

  it("is 404 for an unknown token, an unscheduled or a cancelled meeting", async () => {
    const { GET } = await import("./route");
    mocks.lookup.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(request(), ctx)).status).toBe(404);
    mocks.lookup.mockResolvedValueOnce({
      data: { ...tokenInfoFixture, meeting: { ...meeting, startsAt: null } },
      error: null,
    });
    expect((await GET(request(), ctx)).status).toBe(404);
    mocks.lookup.mockResolvedValueOnce({
      data: {
        ...tokenInfoFixture,
        meeting: { ...meeting, status: "cancelled" as const },
      },
      error: null,
    });
    expect((await GET(request(), ctx)).status).toBe(404);
  });
});
