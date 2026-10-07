import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({
  context: { value: null as object | null },
  getMeetingDefaults: vi.fn(),
  updateMeetingDefaults: vi.fn(),
}));
vi.mock("@/server/http/workspace-context", () => ({
  loadWorkspaceContext: async () => mocks.context.value ?? okContext,
}));
vi.mock("@/server/queries/sender", () => ({
  getMeetingDefaults: mocks.getMeetingDefaults,
  updateMeetingDefaults: mocks.updateMeetingDefaults,
}));

const ctx = { params: Promise.resolve({ slug: "club-ab12" }) };
const defaults = {
  responseMode: "attendance",
  delayOptions: [5, 10, 15, 30],
  reasonRequired: true,
  commentsEnabled: false,
  footerNote: "",
  durationMinutes: 60,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("/api/workspaces/[slug]/meeting-defaults", () => {
  it("returns the defaults", async () => {
    mocks.getMeetingDefaults.mockResolvedValueOnce({
      data: defaults,
      error: null,
    });
    const { GET } = await import("./route");
    expect(await (await GET(jsonRequest("GET"), ctx)).json()).toEqual(defaults);
  });

  it("updates valid fields and refuses Viewers and bad input", async () => {
    mocks.updateMeetingDefaults.mockResolvedValue({ error: null });
    const { PATCH } = await import("./route");
    expect(
      (await PATCH(jsonRequest("PATCH", { delayOptions: [30, 10] }), ctx))
        .status,
    ).toBe(200);
    expect(mocks.updateMeetingDefaults).toHaveBeenCalledWith({}, "w1", {
      delayOptions: [10, 30],
    });
    expect(
      (await PATCH(jsonRequest("PATCH", { delayOptions: [5, 5] }), ctx)).status,
    ).toBe(400);
    mocks.context.value = viewerContext;
    expect(
      (await PATCH(jsonRequest("PATCH", { durationMinutes: 30 }), ctx)).status,
    ).toBe(403);
  });
});
