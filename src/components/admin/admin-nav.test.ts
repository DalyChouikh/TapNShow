import { describe, expect, it } from "vitest";
import { ADMIN_NAV, activeAdminItem } from "./admin-nav";

describe("admin nav", () => {
  it("has the five tabs in order", () => {
    expect(ADMIN_NAV.map((item) => item.key)).toEqual([
      "overview",
      "workspaces",
      "reports",
      "admins",
      "log",
    ]);
  });

  it.each([
    ["/admin", "overview"],
    ["/admin/workspaces", "workspaces"],
    ["/admin/workspaces/6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "workspaces"],
    ["/admin/log", "log"],
    ["/admin/logbook", "overview"],
  ])("%s → %s", (path, key) => {
    expect(activeAdminItem(path)).toBe(key);
  });
});
