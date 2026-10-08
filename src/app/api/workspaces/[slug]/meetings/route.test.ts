import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { value: null as object | null },
  listMeetingsPage: vi.fn(),
  createMeeting: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.value ?? okContext,
}));
vi.mock("@/server/queries/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/meetings")>()),
  listMeetingsPage: mocks.listMeetingsPage,
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
  responseMode: "attendance",
  counts: {
    invited: 0,
    sent: 0,
    queued: 0,
    attending: 0,
    late: 0,
    absent: 0,
    noReply: 0,
  },
};
const page = (query: string) =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/meetings${query}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meetings", () => {
  it("lists one page of a tab", async () => {
    mocks.listMeetingsPage.mockResolvedValueOnce({
      data: { items: [summary], nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(page("?tab=drafts&limit=20"), ctx);
    expect(await response.json()).toEqual({
      items: [summary],
      nextCursor: null,
    });
    expect(mocks.listMeetingsPage).toHaveBeenCalledWith(
      {},
      "w1",
      "drafts",
      20,
      null,
    );
  });

  it("refuses an unknown tab or a malformed cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(page("?tab=all"), ctx)).status).toBe(400);
    expect((await GET(page("?cursor=garbage"), ctx)).status).toBe(400);
    expect(mocks.listMeetingsPage).not.toHaveBeenCalled();
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
