import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { membersFixture } from "@/test/fixtures/members";
import { okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ listMembersPage: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/queries/members")>()),
  listMembersPage: mocks.listMembersPage,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const get = (query = "") =>
  new NextRequest(
    `http://localhost:3000/api/workspaces/club-ab12/members${query}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("GET /api/workspaces/[slug]/members", () => {
  it("returns one page of members, optionally one role", async () => {
    mocks.listMembersPage.mockResolvedValue({
      data: { items: membersFixture, nextCursor: null },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(get("?role=admin&limit=10"), ctx);
    expect(await response.json()).toEqual({
      items: membersFixture,
      nextCursor: null,
    });
    expect(mocks.listMembersPage).toHaveBeenCalledWith(
      {},
      "w1",
      "admin",
      10,
      null,
    );
  });

  it("refuses an unknown role or a malformed cursor", async () => {
    const { GET } = await import("./route");
    expect((await GET(get("?role=boss"), ctx)).status).toBe(400);
    expect((await GET(get("?cursor=garbage"), ctx)).status).toBe(400);
    expect(mocks.listMembersPage).not.toHaveBeenCalled();
  });
});
