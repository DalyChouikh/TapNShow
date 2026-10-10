import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () => ({ ...okContext, meeting: meetingFixture }),
}));
const queries = vi.hoisted(() => ({ listMeetingPeople: vi.fn() }));
vi.mock("@/server/queries/results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/results")>()),
  listMeetingPeople: queries.listMeetingPeople,
}));
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};
const get = (query = "") =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/meetings/x/people${query}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("GET …/meetings/[id]/people", () => {
  it("returns one page for the filter", async () => {
    queries.listMeetingPeople.mockResolvedValueOnce({
      data: { items: [], nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(get("?filter=late&limit=20"), ctx);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(queries.listMeetingPeople).toHaveBeenCalledWith(
      {},
      MEETING_IDS.meeting,
      "late",
      20,
      null,
      null,
    );
  });

  it("searches names and emails, trimmed, up to 120 characters (M6)", async () => {
    queries.listMeetingPeople.mockResolvedValue({
      data: { items: [], nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    await GET(get("?filter=to_reconfirm&search=%20sarra%20"), ctx);
    expect(queries.listMeetingPeople).toHaveBeenLastCalledWith(
      {},
      MEETING_IDS.meeting,
      "to_reconfirm",
      50,
      null,
      "sarra",
    );
    expect((await GET(get(`?search=${"x".repeat(121)}`), ctx)).status).toBe(
      400,
    );
  });

  it("refuses an unknown filter or a malformed cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?filter=maybe"), ctx)).status).toBe(400);
    expect((await GET(get("?cursor=garbage"), ctx)).status).toBe(400);
    expect(queries.listMeetingPeople).not.toHaveBeenCalled();
  });
});
