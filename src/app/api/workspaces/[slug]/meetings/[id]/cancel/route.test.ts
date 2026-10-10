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
const queries = vi.hoisted(() => ({
  cancelMeeting: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/queries/meetings", () => ({
  cancelMeeting: queries.cancelMeeting,
}));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({
  scheduleDispatch: queries.schedule,
}));

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/cancel", () => {
  it("cancels and starts sending the cancellations", async () => {
    queries.cancelMeeting.mockResolvedValueOnce({
      data: { emails: 3 },
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", {}), ctx);
    expect(await response.json()).toEqual({ emails: 3 });
    expect(queries.schedule).toHaveBeenCalledTimes(1);
  });

  it("refuses a started meeting, Viewers and other sites", async () => {
    queries.cancelMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:meeting_started" },
    });
    const { POST } = await import("./route");
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(409);
    expect(queries.schedule).not.toHaveBeenCalled();
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(403);
    const crossSite = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    const response = await POST(crossSite, ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "invalid_origin" },
    });
  });
});
