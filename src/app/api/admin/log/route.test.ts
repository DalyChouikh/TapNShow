import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminContextAs, adminRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({ context: vi.fn(), adminLog: vi.fn() }));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({ adminLog: mocks.adminLog }));

const { GET } = await import("./route");
const get = (query = "") => GET(adminRequest("GET", `/api/admin/log${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/log", () => {
  it("answers 401 signed out, 404 to a non-admin, 400 for an unknown filter", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get()).status).toBe(404);
    expect((await get("?filter=everything")).status).toBe(400);
  });

  it("pages newest first by id, with the filter", async () => {
    mocks.adminLog.mockResolvedValueOnce({
      data: [{ id: 9 }, { id: 8 }],
      error: null,
    });
    const body = await (await get("?filter=suspensions&limit=1")).json();
    expect(body.items).toEqual([{ id: 9 }]);
    expect(mocks.adminLog).toHaveBeenCalledWith({}, "suspensions", null, 1);
    mocks.adminLog.mockResolvedValueOnce({ data: [], error: null });
    await get(`?cursor=${body.nextCursor}`);
    expect(mocks.adminLog).toHaveBeenLastCalledWith(
      {},
      "all",
      9,
      expect.any(Number),
    );
  });
});
