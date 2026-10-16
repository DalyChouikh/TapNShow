import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminMarkReviewed: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminMarkReviewed: mocks.adminMarkReviewed,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { POST } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = params({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("POST /api/admin/reports/[id]/reviewed", () => {
  it("refuses other sites, signed-out people, non-admins and a malformed id", async () => {
    expect((await POST(crossSiteRequest("POST"), ctx)).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await POST(adminRequest("POST"), ctx)).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await POST(adminRequest("POST"), ctx)).status).toBe(404);
    expect((await POST(adminRequest("POST"), params({ id: "x" }))).status).toBe(
      400,
    );
  });

  it("marks it reviewed and starts the platform lane; a limit refusal is mapped", async () => {
    mocks.adminMarkReviewed.mockResolvedValueOnce({ data: true, error: null });
    expect(await (await POST(adminRequest("POST"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.adminMarkReviewed).toHaveBeenCalledWith({}, ID);
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
    mocks.adminMarkReviewed.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:rate_limited" },
    });
    expect((await POST(adminRequest("POST"), ctx)).status).toBe(429);
  });
});
