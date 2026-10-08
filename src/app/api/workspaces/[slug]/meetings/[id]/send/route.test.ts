import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () =>
    mocks.context.value ?? { ...okContext, meeting: meetingFixture },
}));
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

const queries = vi.hoisted(() => ({ sendMeeting: vi.fn(), schedule: vi.fn() }));
vi.mock("@/server/queries/meetings", () => ({
  sendMeeting: queries.sendMeeting,
}));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({
  scheduleDispatch: queries.schedule,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/send", () => {
  it("sends and starts a dispatch", async () => {
    queries.sendMeeting.mockResolvedValueOnce({
      data: { invited: 27, skippedUnsubscribed: 1 },
      error: null,
    });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST", {}), ctx)).json()).toEqual({
      invited: 27,
      skippedUnsubscribed: 1,
    });
    expect(queries.schedule).toHaveBeenCalledTimes(1);
  });

  it("names a missing sender and does not dispatch; refuses Viewers", async () => {
    queries.sendMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:sender_not_connected" },
    });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", {}), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "sender_not_connected" },
    });
    expect(queries.schedule).not.toHaveBeenCalled();
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(403);
  });
});
