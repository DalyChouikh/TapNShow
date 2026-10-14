import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string | null;
  } | null,
  getMyInvites: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/my-invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/my-invites")>()),
  getMyInvites: mocks.getMyInvites,
}));

const get = (query = "") =>
  new Request(`http://localhost:3000/api/me/invites${query}`);
const empty = {
  items: [],
  nextCursor: null,
  needsCount: 0,
  asOf: "2026-10-14T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/invites", () => {
  it("is 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET(get())).status).toBe(401);
  });

  it("passes the tab, the filter, the page size and the cursor", async () => {
    mocks.getMyInvites.mockResolvedValueOnce({ data: empty, error: null });
    const { GET } = await import("./route");
    const cursor = Buffer.from(
      JSON.stringify([
        "2026-10-20T16:00:00.000Z",
        "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
      ]),
    ).toString("base64url");
    const response = await GET(
      get(`?tab=upcoming&filter=needs&limit=20&cursor=${cursor}`),
    );
    expect(await response.json()).toEqual(empty);
    expect(mocks.getMyInvites).toHaveBeenCalledWith(
      {},
      "upcoming",
      "needs",
      20,
      ["2026-10-20T16:00:00.000Z", "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa"],
    );
  });

  it("refuses the needs filter on Past and a foreign cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?tab=past&filter=needs"))).status).toBe(400);
    expect((await GET(get("?cursor=bm9wZQ"))).status).toBe(400);
  });
});
