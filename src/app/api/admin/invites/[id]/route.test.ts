import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminInviteRevoke: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminInviteRevoke: mocks.adminInviteRevoke,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { DELETE } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = params({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("owner"));
});

describe("DELETE /api/admin/invites/[id]", () => {
  it("is the platform owner's", async () => {
    expect((await DELETE(crossSiteRequest("DELETE"), ctx)).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("admin"));
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(404);
    expect(
      (await DELETE(adminRequest("DELETE"), params({ id: "x" }))).status,
    ).toBe(400);
  });

  it("revokes and starts the platform lane; an already closed invite is 409", async () => {
    mocks.adminInviteRevoke.mockResolvedValueOnce({ data: true, error: null });
    expect(await (await DELETE(adminRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.adminInviteRevoke).toHaveBeenCalledWith({}, ID);
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
    mocks.adminInviteRevoke.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:invite_closed" },
    });
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(409);
  });
});
