import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminContextAs,
  adminRequest,
  crossSiteRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  suspendWorkspace: vi.fn(),
  liftSuspension: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  suspendWorkspace: mocks.suspendWorkspace,
  liftSuspension: mocks.liftSuspension,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const { POST, DELETE } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = params({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
  mocks.suspendWorkspace.mockResolvedValue({ data: true, error: null });
  mocks.liftSuspension.mockResolvedValue({ data: true, error: null });
});

describe("POST / DELETE /api/admin/workspaces/[id]/suspension", () => {
  it("refuses other sites, signed-out people and non-admins", async () => {
    expect((await POST(crossSiteRequest("POST"), ctx)).status).toBe(403);
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await POST(adminRequest("POST"), ctx)).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(404);
    expect(mocks.suspendWorkspace).not.toHaveBeenCalled();
    expect((await POST(adminRequest("POST"), params({ id: "x" }))).status).toBe(
      400,
    );
  });

  it("suspends and lifts, then starts the platform lane", async () => {
    expect(await (await POST(adminRequest("POST"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.suspendWorkspace).toHaveBeenCalledWith({}, ID);
    expect((await DELETE(adminRequest("DELETE"), ctx)).status).toBe(200);
    expect(mocks.liftSuspension).toHaveBeenCalledWith({}, ID);
    expect(mocks.schedule).toHaveBeenCalledTimes(2);
    expect(mocks.schedule).toHaveBeenCalledWith(["platform"]);
  });

  it("answers 409 to a second suspension, without starting the lane", async () => {
    mocks.suspendWorkspace.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:conflict" },
    });
    expect((await POST(adminRequest("POST"), ctx)).status).toBe(409);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
