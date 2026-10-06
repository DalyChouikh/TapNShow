import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { rosterFixture } from "@/test/fixtures/roster";
import { viewerContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => viewerContext,
}));
vi.mock("@/server/queries/roster", () => ({
  getRoster: async () => rosterFixture,
}));

describe("GET /api/workspaces/[slug]/contacts", () => {
  it("returns the roster to any member, Viewers included", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/workspaces/club-ab12/contacts",
      ),
      { params: Promise.resolve({ slug: "club-ab12" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rosterFixture);
  });
});
