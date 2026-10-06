import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ bulkContacts: vi.fn() }));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bulkContacts.mockResolvedValue({ data: 2, error: null });
});

describe("POST /api/workspaces/[slug]/contacts/bulk", () => {
  it("adds people to a list and reports how many changed", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("POST", {
        action: "addToList",
        contactIds: [IDS.ines, IDS.sarra],
        listId: IDS.dev,
      }),
      ctx,
    );
    expect(await response.json()).toEqual({ affected: 2 });
    expect(mocks.bulkContacts).toHaveBeenCalledWith(
      {},
      {
        workspaceId: "w1",
        action: "addToList",
        contactIds: [IDS.ines, IDS.sarra],
        listId: IDS.dev,
      },
    );
  });

  it("maps an unknown list", async () => {
    mocks.bulkContacts.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("POST", {
        action: "removeFromList",
        contactIds: [IDS.ines],
        listId: IDS.dev,
      }),
      ctx,
    );
    expect(response.status).toBe(404);
  });
});
