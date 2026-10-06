import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/test/fixtures/roster";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

type Result = {
  data: Array<{ id: string }> | null;
  error: { code?: string; message: string } | null;
};
const found: Result = { data: [{ id: IDS.ines }], error: null };
const mocks = vi.hoisted(() => ({
  updateContact: vi.fn(),
  setContactLists: vi.fn(),
  deleteContact: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/roster", () => mocks);

const ctx = { params: Promise.resolve({ slug: "club-ab12", id: IDS.ines }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateContact.mockResolvedValue(found);
  mocks.setContactLists.mockResolvedValue({ error: null });
  mocks.deleteContact.mockResolvedValue(found);
});

describe("/api/workspaces/[slug]/contacts/[id]", () => {
  it("PATCH renames without touching lists", async () => {
    const { PATCH } = await import("./route");
    expect(
      (await PATCH(jsonRequest("PATCH", { fullName: " Inès B. " }), ctx))
        .status,
    ).toBe(200);
    expect(mocks.updateContact).toHaveBeenCalledWith(
      {},
      {
        workspaceId: "w1",
        contactId: IDS.ines,
        fullName: "Inès B.",
        email: undefined,
      },
    );
    expect(mocks.setContactLists).not.toHaveBeenCalled();
  });

  it("PATCH with listIds only replaces the lists", async () => {
    const { PATCH } = await import("./route");
    expect(
      (await PATCH(jsonRequest("PATCH", { listIds: [IDS.dev] }), ctx)).status,
    ).toBe(200);
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(mocks.setContactLists).toHaveBeenCalledWith({}, IDS.ines, [IDS.dev]);
  });

  it("PATCH reports a taken email and an unknown person", async () => {
    mocks.updateContact.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const { PATCH } = await import("./route");
    const taken = await PATCH(
      jsonRequest("PATCH", { email: "sarra@example.com" }),
      ctx,
    );
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      error: { code: "contact_email_taken" },
    });
    mocks.updateContact.mockResolvedValueOnce({ data: [], error: null });
    expect(
      (await PATCH(jsonRequest("PATCH", { fullName: "X" }), ctx)).status,
    ).toBe(404);
  });

  it("DELETE removes the person or answers 404", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    mocks.deleteContact.mockResolvedValueOnce({ data: [], error: null });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });
});
