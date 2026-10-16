import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminRemove: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({ adminRemove: mocks.adminRemove }));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { DELETE } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = params({ userId: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("owner"));
});

describe("DELETE /api/admin/admins/[userId]", () => {
  it("is the platform owner's: other sites, signed-out people, non-admins and admins are refused", async () => {
    expect((await DELETE(crossSiteRequest("DELETE"), ctx)).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(404);
    mocks.context.mockResolvedValueOnce(adminContextAs("admin"));
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(404);
    expect(mocks.adminRemove).not.toHaveBeenCalled();
    expect(
      (await DELETE(adminRequest("DELETE"), params({ userId: "x" }))).status,
    ).toBe(400);
  });

  it("removes the admin and starts the platform lane; the owner can't be removed (403)", async () => {
    mocks.adminRemove.mockResolvedValueOnce({ data: true, error: null });
    expect(await (await DELETE(adminRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.adminRemove).toHaveBeenCalledWith({}, ID);
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
    mocks.adminRemove.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:forbidden" },
    });
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(403);
  });
});
