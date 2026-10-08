import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { value: null as object | null },
  listMeetings: vi.fn(),
  createMeeting: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.value ?? okContext,
}));
vi.mock("@/server/queries/meetings", () => ({
  listMeetings: mocks.listMeetings,
  createMeeting: mocks.createMeeting,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const summary = {
  id: MEETING_IDS.meeting,
  title: "Weekly sync",
  startsAt: null,
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "draft",
  locationMode: "in_person",
  invitedCount: 0,
  sentCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meetings", () => {
  it("lists the meetings", async () => {
    mocks.listMeetings.mockResolvedValueOnce({ data: [summary], error: null });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual([
      summary,
    ]);
    expect(mocks.listMeetings).toHaveBeenCalledWith({}, "w1");
  });

  it("creates a draft and names the rate limit", async () => {
    mocks.createMeeting.mockResolvedValueOnce({
      data: MEETING_IDS.meeting,
      error: null,
    });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST", {}), ctx)).json()).toEqual({
      id: MEETING_IDS.meeting,
    });
    mocks.createMeeting.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:rate_limited" },
    });
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(429);
  });

  it("refuses Viewers and other origins", async () => {
    const { POST } = await import("./route");
    mocks.context.value = viewerContext;
    expect((await POST(jsonRequest("POST", {}), ctx)).status).toBe(403);
    mocks.context.value = null;
    const foreign = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    expect((await POST(foreign, ctx)).status).toBe(403);
    expect(mocks.createMeeting).not.toHaveBeenCalled();
  });
});
