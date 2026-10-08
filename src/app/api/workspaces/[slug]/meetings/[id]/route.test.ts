import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/server/http/errors";
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

const queries = vi.hoisted(() => ({
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
}));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meetings/[id]", () => {
  it("returns the meeting, and 404 when it belongs to another workspace", async () => {
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(
      meetingFixture,
    );
    mocks.context.value = { ok: false, response: apiError("not_found") };
    expect((await GET(jsonRequest("GET"), ctx)).status).toBe(404);
  });

  it("saves a trimmed title on a draft and refuses sent meetings and Viewers", async () => {
    queries.updateMeeting.mockResolvedValueOnce({
      data: { ...meetingFixture, title: "X" },
      error: null,
    });
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest("PATCH", { title: " X " }), ctx);
    expect((await response.json()).title).toBe("X");
    expect(queries.updateMeeting).toHaveBeenCalledWith(
      {},
      "w1",
      MEETING_IDS.meeting,
      { title: "X" },
    );
    mocks.context.value = {
      ...okContext,
      meeting: { ...meetingFixture, status: "scheduled" },
    };
    expect(
      await (await PATCH(jsonRequest("PATCH", { title: "Y" }), ctx)).json(),
    ).toEqual({ error: { code: "meeting_not_draft" } });
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect(
      (await PATCH(jsonRequest("PATCH", { title: "Y" }), ctx)).status,
    ).toBe(403);
    mocks.context.value = null;
    expect(
      (await PATCH(jsonRequest("PATCH", { meetingUrl: "javascript:x" }), ctx))
        .status,
    ).toBe(400);
  });

  it("deletes drafts only", async () => {
    queries.deleteMeeting.mockResolvedValueOnce({ data: true, error: null });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    mocks.context.value = {
      ...okContext,
      meeting: { ...meetingFixture, status: "scheduled" },
    };
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(409);
  });
});
