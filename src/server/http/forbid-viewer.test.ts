import { describe, expect, it } from "vitest";
import { forbidViewer } from "./forbid-viewer";

describe("forbidViewer", () => {
  it("returns 403 for Viewers and null for Owner/Admin", async () => {
    const base = {
      id: "w1",
      slug: "s",
      name: "N",
      timezone: "Africa/Tunis",
      canCheckIn: false,
    };
    const viewer = forbidViewer({ ...base, myRole: "viewer" });
    expect(viewer?.status).toBe(403);
    expect(await viewer?.json()).toEqual({ error: { code: "forbidden" } });
    expect(forbidViewer({ ...base, myRole: "admin" })).toBeNull();
    expect(forbidViewer({ ...base, myRole: "owner" })).toBeNull();
  });
});
