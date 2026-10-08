import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ getMeeting: vi.fn() }));
vi.mock("./workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/meetings", () => mocks);

beforeEach(() => vi.clearAllMocks());

describe("loadMeetingContext", () => {
  it("adds the meeting when it belongs to the slug's workspace", async () => {
    mocks.getMeeting.mockResolvedValueOnce({
      data: meetingFixture,
      error: null,
    });
    const { loadMeetingContext } = await import("./meeting-context");
    const context = await loadMeetingContext("club-ab12", MEETING_IDS.meeting);
    expect(context).toMatchObject({ ok: true, meeting: meetingFixture });
    expect(mocks.getMeeting).toHaveBeenCalledWith(
      {},
      "w1",
      MEETING_IDS.meeting,
    );
  });

  it("answers 404 for another workspace's meeting and 400 for a bad id", async () => {
    const { loadMeetingContext } = await import("./meeting-context");
    mocks.getMeeting.mockResolvedValueOnce({ data: null, error: null });
    const missing = await loadMeetingContext("club-ab12", MEETING_IDS.meeting);
    expect(missing.ok ? 200 : missing.response.status).toBe(404);
    mocks.getMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "22P02", message: "invalid input syntax for type uuid" },
    });
    const bad = await loadMeetingContext("club-ab12", "nope");
    expect(bad.ok ? 200 : bad.response.status).toBe(400);
  });
});
