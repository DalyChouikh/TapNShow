import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "a@example.test" } as {
    id: string;
    email: string | null;
  } | null,
  getMyAnswers: vi.fn(),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user,
}));
vi.mock("@/server/queries/my-invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/my-invites")>()),
  getMyAnswers: mocks.getMyAnswers,
}));

const get = (query = "") =>
  new Request(`http://localhost:3000/api/me/answers${query}`);
const AFTER = [
  "2026-10-20T16:00:00.000Z",
  "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "u1", email: "a@example.test" };
});

describe("GET /api/me/answers", () => {
  it("is 401 without a session", async () => {
    mocks.user = null;
    const { GET } = await import("./route");
    expect((await GET(get())).status).toBe(401);
  });

  it("passes the page size and the cursor, and is never cached", async () => {
    mocks.getMyAnswers.mockResolvedValueOnce({
      data: { items: [], nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    const cursor = Buffer.from(JSON.stringify(AFTER)).toString("base64url");
    const response = await GET(get(`?limit=100&cursor=${cursor}`));
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getMyAnswers).toHaveBeenCalledWith({}, 100, AFTER);
  });

  it("refuses a foreign cursor and says when downloads are rate limited", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?cursor=bm9wZQ"))).status).toBe(400);
    mocks.getMyAnswers.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:rate_limited" },
    });
    expect((await GET(get())).status).toBe(429);
  });
});
