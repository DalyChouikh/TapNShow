import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  meetingFixture,
  MEETING_IDS,
  progressFixture,
} from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => ({ ...okContext, meeting: meetingFixture }),
}));
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

const queries = vi.hoisted(() => ({ getProgress: vi.fn() }));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => vi.clearAllMocks());

describe("GET …/meetings/[id]/progress", () => {
  it("returns the progress", async () => {
    queries.getProgress.mockResolvedValueOnce({
      data: progressFixture,
      error: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(
      progressFixture,
    );
    expect(queries.getProgress).toHaveBeenCalledWith({}, MEETING_IDS.meeting);
  });
});
