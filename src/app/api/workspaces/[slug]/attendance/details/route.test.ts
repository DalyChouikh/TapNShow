import { beforeEach, describe, expect, it, vi } from "vitest";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
const queries = vi.hoisted(() => ({ listAttendanceDetails: vi.fn() }));
vi.mock("@/server/queries/results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/results")>()),
  listAttendanceDetails: queries.listAttendanceDetails,
}));
const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const get = (query = "") =>
  new Request(
    `http://localhost:3000/api/workspaces/club-ab12/attendance/details${query}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("GET …/attendance/details", () => {
  it("returns one page of export rows", async () => {
    queries.listAttendanceDetails.mockResolvedValueOnce({
      data: { items: [], nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    await GET(get("?limit=100"), ctx);
    expect(queries.listAttendanceDetails).toHaveBeenCalledWith(
      {},
      "w1",
      { from: null, to: null },
      100,
      null,
    );
  });

  it("refuses a malformed cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?cursor=garbage"), ctx)).status).toBe(400);
  });
});
