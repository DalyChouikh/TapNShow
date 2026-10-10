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
const queries = vi.hoisted(() => ({ editSentMeeting: vi.fn() }));
vi.mock("@/server/queries/meetings", () => queries);

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};
const result = {
  changed: true,
  changes: { location_text: ["Room B12", "Hall A"] },
  emails: 2,
  calendarOnly: 0,
  reconfirm: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/changes", () => {
  it("previews an edit without saving", async () => {
    queries.editSentMeeting.mockResolvedValueOnce({
      data: result,
      error: null,
    });
    const { POST } = await import("./route");
    const body = {
      fields: { locationText: "Hall A" },
      notify: false,
      dryRun: true,
    };
    const response = await POST(jsonRequest("POST", body), ctx);
    expect(await response.json()).toEqual(result);
    expect(queries.editSentMeeting).toHaveBeenCalledWith(
      okContext.supabase,
      MEETING_IDS.meeting,
      body,
    );
  });

  it("refuses Viewers, the answer type, and passes the deadline rule's code", async () => {
    const { POST } = await import("./route");
    const ok = { fields: { title: "x" }, notify: false, dryRun: false };
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await POST(jsonRequest("POST", ok), ctx)).status).toBe(403);
    mocks.context.value = null;
    const locked = await POST(
      jsonRequest("POST", { ...ok, fields: { responseMode: "rsvp" } }),
      ctx,
    );
    expect(locked.status).toBe(400);
    expect(await locked.json()).toEqual({ error: { code: "invalid_input" } });
    queries.editSentMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:deadline_after_start" },
    });
    const late = await POST(jsonRequest("POST", ok), ctx);
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({
      error: { code: "deadline_after_start" },
    });
  });
});
