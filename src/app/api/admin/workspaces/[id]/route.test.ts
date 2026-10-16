import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminContextAs,
  adminRequest,
  params,
} from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({ context: vi.fn(), adminWorkspace: vi.fn() }));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminWorkspace: mocks.adminWorkspace,
}));

const { GET } = await import("./route");
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const get = (id = ID) => GET(adminRequest("GET"), params({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/workspaces/[id]", () => {
  it("answers 401 signed out, 404 to a non-admin, 400 for a malformed id", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get()).status).toBe(404);
    expect((await get("nope")).status).toBe(400);
  });

  it("returns the workspace, and not found once it is deleted", async () => {
    mocks.adminWorkspace.mockResolvedValueOnce({
      data: { id: ID },
      error: null,
    });
    expect(await (await get()).json()).toEqual({ id: ID });
    expect(mocks.adminWorkspace).toHaveBeenCalledWith({}, ID);
    mocks.adminWorkspace.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    expect((await get()).status).toBe(404);
  });
});
