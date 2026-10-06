import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Owners and Admins all five slots with + disabled until M4", () => {
    expect(navItemsFor("admin", "club-ab12")).toEqual([
      { key: "home", href: "/w/club-ab12", enabled: true },
      { key: "meetings", href: "/w/club-ab12/meetings", enabled: true },
      { key: "new", href: "/w/club-ab12/meetings/new", enabled: false },
      { key: "lists", href: "/w/club-ab12/lists", enabled: true },
      { key: "settings", href: "/w/club-ab12/settings", enabled: true },
    ]);
  });

  it("hides + from Viewers", () => {
    expect(navItemsFor("viewer", "club-ab12").map((item) => item.key)).toEqual([
      "home",
      "meetings",
      "lists",
      "settings",
    ]);
  });
});
