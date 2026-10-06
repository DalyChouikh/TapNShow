import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  transferOwnership: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/members", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces/[slug]/transfer", () => {
  it("rejects a non-uuid userId before calling the database", async () => {
    const { POST } = await import("./route");
    expect(
      (
        await POST(
          new NextRequest(
            jsonRequest("POST", { userId: "x", confirmName: "A" }),
          ),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("maps tn:target_not_admin to 409", async () => {
    mocks.transferOwnership.mockResolvedValueOnce({
      error: { message: "tn:target_not_admin" },
    });
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        jsonRequest("POST", {
          userId: crypto.randomUUID(),
          confirmName: "Robotics Club",
        }),
      ),
      ctx,
    );
    expect(response.status).toBe(409);
  });
});
