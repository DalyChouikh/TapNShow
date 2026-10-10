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
const queries = vi.hoisted(() => ({ duplicateMeeting: vi.fn() }));
vi.mock("@/server/queries/meetings", () => ({
  duplicateMeeting: queries.duplicateMeeting,
}));

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};
const COPY = "9b1f2a3c-4d5e-4f60-8a71-b2c3d4e5f6aa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/duplicate", () => {
  it("creates the copy and returns its id", async () => {
    queries.duplicateMeeting.mockResolvedValueOnce({ data: COPY, error: null });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", {}), ctx);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: COPY });
    expect(queries.duplicateMeeting).toHaveBeenCalledWith(
      okContext.supabase,
      MEETING_IDS.meeting,
    );
  });

  it("refuses Viewers and other sites", async () => {
    const { POST } = await import("./route");
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(403);
    mocks.context.value = null;
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
    expect(queries.duplicateMeeting).not.toHaveBeenCalled();
  });

  it("says when too many meetings were created", async () => {
    queries.duplicateMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:rate_limited" },
    });
    const { POST } = await import("./route");
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(429);
  });
});
