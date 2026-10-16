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
const PERIOD = "?from=2026-10-10&to=2026-10-16";
const get = (query = "") =>
  GET(adminRequest("GET", `/api/admin/overview${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/overview", () => {
  it("answers 401 signed out and 404 to a non-admin", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get(PERIOD)).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get(PERIOD)).status).toBe(404);
  });

  it("reads the period it is given, and refuses a missing or reversed one", async () => {
    mocks.adminOverview.mockResolvedValue({
      data: { current: {} },
      error: null,
    });
    const response = await get("?from=2026-10-10&to=2026-10-16");
    expect(await response.json()).toEqual({ current: {} });
    expect(mocks.adminOverview).toHaveBeenLastCalledWith(
      {},
      { from: "2026-10-10", to: "2026-10-16" },
    );
    expect((await get()).status).toBe(400);
    expect((await get("?from=2026-10-10")).status).toBe(400);
    expect((await get("?from=2026-13-01&to=2026-10-16")).status).toBe(400);
    expect((await get("?from=2026-10-16&to=2026-10-10")).status).toBe(400);
    expect(mocks.adminOverview).toHaveBeenCalledOnce();
  });

  it("maps a database refusal", async () => {
    mocks.adminOverview.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    expect((await get(PERIOD)).status).toBe(404);
  });
});
