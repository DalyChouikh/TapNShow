import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  audienceFixture,
  meetingFixture,
  MEETING_IDS,
} from "@/test/fixtures/meetings";
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
  getAudience: vi.fn(),
  setAudience: vi.fn(),
}));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
  queries.getAudience.mockResolvedValue({ data: audienceFixture, error: null });
});

describe("…/meetings/[id]/audience", () => {
  it("replaces the audience and returns the fresh one", async () => {
    queries.setAudience.mockResolvedValueOnce({ error: null });
    const { PUT } = await import("./route");
    const body = {
      listIds: [MEETING_IDS.members],
      include: [],
      exclude: [MEETING_IDS.lina],
    };
    expect(await (await PUT(jsonRequest("PUT", body), ctx)).json()).toEqual(
      audienceFixture,
    );
    expect(queries.setAudience).toHaveBeenCalledWith(
      {},
      MEETING_IDS.meeting,
      body,
    );
  });

  it("maps a foreign id to 404 and refuses Viewers", async () => {
    queries.setAudience.mockResolvedValueOnce({
      error: { code: "P0001", message: "tn:not_found" },
    });
    const { PUT } = await import("./route");
    expect(
      (
        await PUT(
          jsonRequest("PUT", { listIds: [], include: [], exclude: [] }),
          ctx,
        )
      ).status,
    ).toBe(404);
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect(
      (
        await PUT(
          jsonRequest("PUT", { listIds: [], include: [], exclude: [] }),
          ctx,
        )
      ).status,
    ).toBe(403);
  });
});
