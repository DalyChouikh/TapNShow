import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => ({ ...okContext, meeting: meetingFixture }),
}));
const queries = vi.hoisted(() => ({ markRestAsDeclared: vi.fn() }));
vi.mock("@/server/queries/check-in", () => queries);

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

beforeEach(() => vi.clearAllMocks());

describe("POST …/meetings/[id]/check-in/rest", () => {
  it("marks everyone left and says how many", async () => {
    queries.markRestAsDeclared.mockResolvedValueOnce({ data: 3, error: null });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST", {}), ctx)).json()).toEqual({
      marked: 3,
    });
  });

  it("refuses other sites", async () => {
    const { POST } = await import("./route");
    const crossSite = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    expect((await POST(crossSite, ctx)).status).toBe(403);
    expect(queries.markRestAsDeclared).not.toHaveBeenCalled();
  });
});
