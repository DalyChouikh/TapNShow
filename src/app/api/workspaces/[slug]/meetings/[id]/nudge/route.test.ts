import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => ({ ...okContext, meeting: meetingFixture }),
}));
const queries = vi.hoisted(() => ({
  nudgeMeeting: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/queries/meetings", () => ({
  nudgeMeeting: queries.nudgeMeeting,
}));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({
  scheduleDispatch: queries.schedule,
}));

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST …/meetings/[id]/nudge", () => {
  it("reminds people and starts sending", async () => {
    const next = "2026-10-11T06:00:00.000Z";
    queries.nudgeMeeting.mockResolvedValueOnce({
      data: { reminded: 4, nextAt: next },
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", {}), ctx);
    expect(await response.json()).toEqual({ reminded: 4, nextAt: next });
    expect(queries.schedule).toHaveBeenCalledTimes(1);
  });

  it("says when it is too soon, or Gmail isn't connected", async () => {
    const { POST } = await import("./route");
    queries.nudgeMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:nudge_too_soon" },
    });
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(409);
    queries.nudgeMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:sender_not_connected" },
    });
    const missing = await POST(jsonRequest("POST", {}), ctx);
    expect(await missing.json()).toEqual({
      error: { code: "sender_not_connected" },
    });
    expect(queries.schedule).not.toHaveBeenCalled();
  });
});
