import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  updateWorkspace: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
  deleteWorkspace: vi.fn(async () => ({
    error: null as { message: string } | null,
  })),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/workspaces", () => ({
  updateWorkspace: mocks.updateWorkspace,
  getWorkspaceBySlug: vi.fn(),
}));
vi.mock("@/server/queries/members", () => ({
  deleteWorkspace: mocks.deleteWorkspace,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const asNext = (request: Request) => new NextRequest(request);

beforeEach(() => vi.clearAllMocks());

describe("PATCH/DELETE /api/workspaces/[slug]", () => {
  it("PATCH maps tn:invalid_timezone to 400 and tn:forbidden to 403", async () => {
    const { PATCH } = await import("./route");
    mocks.updateWorkspace.mockResolvedValueOnce({
      error: { message: "tn:invalid_timezone" },
    });
    expect(
      (
        await PATCH(
          asNext(jsonRequest("PATCH", { timezone: "Mars/Olympus" })),
          ctx,
        )
      ).status,
    ).toBe(400);
    mocks.updateWorkspace.mockResolvedValueOnce({
      error: { message: "tn:forbidden" },
    });
    expect(
      (await PATCH(asNext(jsonRequest("PATCH", { name: "X" })), ctx)).status,
    ).toBe(403);
  });

  it("DELETE sends the typed name and maps tn:name_mismatch to 400", async () => {
    const { DELETE } = await import("./route");
    expect(
      (
        await DELETE(
          asNext(jsonRequest("DELETE", { confirmName: "Robotics Club" })),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith(
      {},
      "w1",
      "Robotics Club",
    );
    mocks.deleteWorkspace.mockResolvedValueOnce({
      error: { message: "tn:name_mismatch" },
    });
    expect(
      (
        await DELETE(
          asNext(jsonRequest("DELETE", { confirmName: "nope" })),
          ctx,
        )
      ).status,
    ).toBe(400);
  });
});
