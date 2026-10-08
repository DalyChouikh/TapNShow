import { describe, expect, it } from "vitest";
import { contentWidthFor, navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives Owners and Admins all five slots, + included", () => {
    expect(navItemsFor("admin", "club-ab12")).toEqual([
      { key: "home", href: "/w/club-ab12" },
      { key: "meetings", href: "/w/club-ab12/meetings" },
      { key: "new", href: "/w/club-ab12/meetings/new" },
      { key: "lists", href: "/w/club-ab12/lists" },
      { key: "settings", href: "/w/club-ab12/settings" },
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

describe("contentWidthFor", () => {
  it("gives the roster a wide page and keeps everything else phone-width", () => {
    expect(contentWidthFor("/w/club-ab12/lists", "club-ab12")).toBe("wide");
    // The meeting page's answers table needs room; the wizard and the list stay phone-width.
    expect(
      contentWidthFor(
        "/w/club-ab12/meetings/4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10",
        "club-ab12",
      ),
    ).toBe("wide");
    expect(
      contentWidthFor(
        "/w/club-ab12/meetings/4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10/edit",
        "club-ab12",
      ),
    ).toBe("narrow");
    expect(contentWidthFor("/w/club-ab12/meetings", "club-ab12")).toBe(
      "narrow",
    );
    expect(contentWidthFor("/w/club-ab12/meetings/new", "club-ab12")).toBe(
      "narrow",
    );
    expect(contentWidthFor("/w/club-ab12", "club-ab12")).toBe("narrow");
    expect(contentWidthFor("/w/club-ab12/settings", "club-ab12")).toBe(
      "narrow",
    );
  });
});
