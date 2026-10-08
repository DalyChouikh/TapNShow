import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rosterFixture } from "@/test/fixtures/roster";
import { viewerContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => viewerContext,
}));
const mocks = vi.hoisted(() => ({ getRoster: vi.fn() }));
vi.mock("@/server/queries/roster", () => mocks);

const request = () =>
  new NextRequest("http://localhost:3000/api/workspaces/club-ab12/contacts");
const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => {
  mocks.getRoster.mockResolvedValue({ data: rosterFixture, error: null });
});

describe("GET /api/workspaces/[slug]/contacts", () => {
  it("returns the roster to any member, Viewers included", async () => {
    const { GET } = await import("./route");
    const response = await GET(request(), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rosterFixture);
  });

  it("maps a database error to the API error body", async () => {
    mocks.getRoster.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:forbidden" },
    });
    const { GET } = await import("./route");
    const response = await GET(request(), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
  });
});
