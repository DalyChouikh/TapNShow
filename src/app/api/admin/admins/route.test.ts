import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminContextAs } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({ context: vi.fn(), adminAdmins: vi.fn() }));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({ adminAdmins: mocks.adminAdmins }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/admins", () => {
  it("answers 401 signed out and 404 to a non-admin", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await GET()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await GET()).status).toBe(404);
  });

  it("lists the admins and waiting invites for every admin", async () => {
    mocks.adminAdmins.mockResolvedValueOnce({
      data: { admins: [], invites: [] },
      error: null,
    });
    expect(await (await GET()).json()).toEqual({ admins: [], invites: [] });
  });
});
