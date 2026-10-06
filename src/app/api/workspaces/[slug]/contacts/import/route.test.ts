import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPreviewFixture } from "@/test/fixtures/roster";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { current: null as object | null },
  importContacts: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.current,
}));
vi.mock("@/server/queries/roster", () => ({
  importContacts: mocks.importContacts,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const body = {
  rows: [
    {
      row: 2,
      fullName: "Amira",
      email: "amira@example.com",
      lists: ["Events"],
    },
  ],
  dryRun: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.current = okContext;
  mocks.importContacts.mockResolvedValue({
    data: importPreviewFixture,
    error: null,
  });
});

describe("POST /api/workspaces/[slug]/contacts/import", () => {
  it("returns the dry-run preview", async () => {
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", body), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(importPreviewFixture);
    expect(mocks.importContacts).toHaveBeenCalledWith(
      {},
      { workspaceId: "w1", ...body },
    );
  });

  it("refuses Viewers before touching the database", async () => {
    mocks.context.current = viewerContext;
    const { POST } = await import("./route");
    expect((await POST(jsonRequest("POST", body), ctx)).status).toBe(403);
    expect(mocks.importContacts).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests and malformed bodies", async () => {
    const { POST } = await import("./route");
    const foreign = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify(body),
    });
    expect((await POST(foreign, ctx)).status).toBe(403);
    expect(
      (await POST(jsonRequest("POST", { rows: "nope", dryRun: true }), ctx))
        .status,
    ).toBe(400);
  });

  it("maps database refusals", async () => {
    mocks.importContacts.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:import_too_many_rows" },
    });
    const { POST } = await import("./route");
    const response = await POST(jsonRequest("POST", body), ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "import_too_many_rows" },
    });
  });
});
