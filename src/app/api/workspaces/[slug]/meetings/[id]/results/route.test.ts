import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => ({ ...okContext, meeting: meetingFixture }),
}));
const queries = vi.hoisted(() => ({ getMeetingResults: vi.fn() }));
vi.mock("@/server/queries/results", () => queries);
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

beforeEach(() => vi.clearAllMocks());

describe("GET …/meetings/[id]/results", () => {
  it("returns the meeting's counts", async () => {
    queries.getMeetingResults.mockResolvedValueOnce({
      data: { responseMode: "attendance" },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(jsonRequest("GET"), ctx);
    expect(await response.json()).toEqual({ responseMode: "attendance" });
    expect(queries.getMeetingResults).toHaveBeenCalledWith(
      {},
      MEETING_IDS.meeting,
    );
  });

  it("maps database errors", async () => {
    queries.getMeetingResults.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:not_found" },
    });
    const { GET } = await import("./route");
    expect((await GET(jsonRequest("GET"), ctx)).status).toBe(404);
  });
});
