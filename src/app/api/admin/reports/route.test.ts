import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminContextAs, adminRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({ context: vi.fn(), adminReports: vi.fn() }));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({ adminReports: mocks.adminReports }));

const { GET } = await import("./route");
const get = (query = "") =>
  GET(adminRequest("GET", `/api/admin/reports${query}`));
const report = (id: string, reportedAt: string) => ({ id, reportedAt });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/reports", () => {
  it("answers 401 signed out, 404 to a non-admin, 400 for a foreign cursor", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get()).status).toBe(404);
    expect((await get("?cursor=abc")).status).toBe(400);
  });

  it("pages newest first by (reportedAt, id)", async () => {
    const a = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41";
    mocks.adminReports.mockResolvedValueOnce({
      data: [
        report(a, "2026-10-16T09:00:00+00:00"),
        report("b", "2026-10-15T09:00:00+00:00"),
      ],
      error: null,
    });
    const body = await (await get("?limit=1")).json();
    expect(body.items).toEqual([report(a, "2026-10-16T09:00:00+00:00")]);
    expect(mocks.adminReports).toHaveBeenCalledWith({}, null, 1);
    mocks.adminReports.mockResolvedValueOnce({ data: [], error: null });
    await get(`?cursor=${body.nextCursor}`);
    expect(mocks.adminReports).toHaveBeenLastCalledWith(
      {},
      ["2026-10-16T09:00:00+00:00", a],
      expect.any(Number),
    );
  });
});
