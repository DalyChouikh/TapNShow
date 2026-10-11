import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  retrySheet: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => okContext,
}));
vi.mock("@/server/queries/sheets", () => ({ retrySheet: mocks.retrySheet }));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
beforeEach(() => vi.clearAllMocks());

describe("POST /api/workspaces/[slug]/sheet/retry", () => {
  it("lets the Owner try again and wakes the sheet worker", async () => {
    mocks.retrySheet.mockResolvedValueOnce({ error: null });
    const { POST } = await import("./route");
    expect(await (await POST(jsonRequest("POST"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.retrySheet).toHaveBeenCalledWith({}, "w1");
    expect(mocks.schedule).toHaveBeenCalledWith(["sheets"]);
  });

  it.each([
    ["tn:rate_limited", 429],
    ["tn:invalid_input", 400],
  ])("maps %s to %i without waking anything", async (message, status) => {
    mocks.retrySheet.mockResolvedValueOnce({
      error: { code: "P0001", message },
    });
    const { POST } = await import("./route");
    expect((await POST(jsonRequest("POST"), ctx)).status).toBe(status);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
