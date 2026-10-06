import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { membersFixture } from "@/test/fixtures/members";
import { okContext } from "@/test/workspace-context-mock";

vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/members", () => ({
  listMembers: async () => membersFixture,
}));

describe("GET /api/workspaces/[slug]/members", () => {
  it("returns the members list", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/workspaces/club-ab12/members"),
      { params: Promise.resolve({ slug: "club-ab12" }) },
    );
    expect(await response.json()).toEqual(membersFixture);
  });
});
