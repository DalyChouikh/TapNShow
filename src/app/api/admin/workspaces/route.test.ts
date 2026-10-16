import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminContextAs, adminRequest } from "@/test/admin-context-mock";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  adminWorkspaces: vi.fn(),
}));
vi.mock("@/server/http/admin-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/http/admin-context")>()),
  loadAdminContext: mocks.context,
}));
vi.mock("@/server/queries/admin", () => ({
  adminWorkspaces: mocks.adminWorkspaces,
}));

const { GET } = await import("./route");
const get = (query = "") =>
  GET(adminRequest("GET", `/api/admin/workspaces${query}`));

const row = (id: string, sortValue: string) => ({
  id,
  name: "Robotics Club",
  slug: "robotics-ab12",
  createdAt: "2026-10-02T10:00:00+00:00",
  ownerEmail: "a•••@gmail.com",
  team: 6,
  contacts: 74,
  meetings30d: 6,
  emails30d: 402,
  failed30d: 16,
  reports7d: 3,
  people7d: 74,
  suspended: true,
  sender: "active",
  sheet: "off",
  sortValue,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(adminContextAs("admin"));
});

describe("GET /api/admin/workspaces", () => {
  it("answers 401 signed out and 404 to a non-admin", async () => {
    mocks.context.mockResolvedValueOnce(adminContextAs("signed_out"));
    expect((await get()).status).toBe(401);
    mocks.context.mockResolvedValueOnce(adminContextAs("member"));
    expect((await get()).status).toBe(404);
  });

  it("refuses an unknown filter or sort, and a foreign cursor", async () => {
    expect((await get("?filter=all-of-it")).status).toBe(400);
    expect((await get("?sort=name")).status).toBe(400);
    expect((await get("?cursor=not-ours")).status).toBe(400);
  });

  it("passes search, filter, sort and page; keeps the sort key in the cursor, not the rows", async () => {
    const ids = [
      "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41",
      "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c42",
    ];
    mocks.adminWorkspaces.mockResolvedValueOnce({
      data: [row(ids[0], "402"), row(ids[1], "300")],
      error: null,
    });
    const body = await (
      await get("?q=%20robot%20&filter=reported&sort=emails&limit=1")
    ).json();
    expect(mocks.adminWorkspaces).toHaveBeenCalledWith(
      {},
      { q: "robot", filter: "reported", sort: "emails", after: null, limit: 1 },
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("sortValue");
    expect(body.nextCursor).toEqual(expect.any(String));
    mocks.adminWorkspaces.mockResolvedValueOnce({ data: [], error: null });
    await get(`?sort=emails&cursor=${body.nextCursor}`);
    expect(mocks.adminWorkspaces).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({ after: ["402", ids[0]] }),
    );
  });
});
