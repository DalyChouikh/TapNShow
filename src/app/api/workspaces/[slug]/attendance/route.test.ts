import { beforeEach, describe, expect, it, vi } from "vitest";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
const queries = vi.hoisted(() => ({ getAttendanceSummary: vi.fn() }));
vi.mock("@/server/queries/results", () => queries);
const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const get = (query = "") =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/attendance${query}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("GET …/attendance", () => {
  it("returns the summary for the period", async () => {
    queries.getAttendanceSummary.mockResolvedValueOnce({
      data: { meetings: 0, rows: [] },
      error: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET(get(), ctx)).json()).toEqual({
      meetings: 0,
      rows: [],
    });
    expect(queries.getAttendanceSummary).toHaveBeenCalledWith({}, "w1", {
      from: null,
      to: null,
    });
  });

  it("refuses a malformed period", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?to=tomorrow"), ctx)).status).toBe(400);
  });
});
