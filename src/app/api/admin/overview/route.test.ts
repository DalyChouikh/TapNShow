import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminContextAs, adminRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminOverview: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminOverview: mocks.adminOverview,
}));

const { GET } = await import("./route");
const get = (query = "") =>
  GET(adminRequest("GET", `/api/admin/overview${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/overview", () => {
  it("answers 401 signed out and 404 to a non-admin", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get()).status).toBe(404);
  });

  it("reads 30 days by default, 7 or 90 on request, nothing else", async () => {
    mocks.adminOverview.mockResolvedValue({
      data: { current: {} },
      error: null,
    });
    expect(await (await get()).json()).toEqual({ current: {} });
    expect(mocks.adminOverview).toHaveBeenLastCalledWith({}, 30);
    await get("?days=90");
    expect(mocks.adminOverview).toHaveBeenLastCalledWith({}, 90);
    expect((await get("?days=14")).status).toBe(400);
  });

  it("maps a database refusal", async () => {
    mocks.adminOverview.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    expect((await get()).status).toBe(404);
  });
});
