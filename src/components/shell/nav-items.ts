import type { WorkspaceRole } from "@/shared/api/me";

/** One bottom-bar slot. */
export type NavItem = {
  key: "home" | "meetings" | "new" | "lists" | "settings";
  href: string;
};

/** Bottom bar (spec §4 "Hub + center +"): "+" starts a new meeting; Viewers never see it. */
export function navItemsFor(role: WorkspaceRole, slug: string): NavItem[] {
  const base = `/w/${slug}`;
  const items: NavItem[] = [
    { key: "home", href: base },
    { key: "meetings", href: `${base}/meetings` },
    { key: "new", href: `${base}/meetings/new` },
    { key: "lists", href: `${base}/lists` },
    { key: "settings", href: `${base}/settings` },
  ];
  return role === "viewer" ? items.filter((item) => item.key !== "new") : items;
}

/** Pages whose content needs more than phone width on larger screens (the roster grid, the answers table). */
const WIDE_SECTIONS: readonly string[] = ["lists"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "wide" lets a page use the full width from `md` up; every other page stays phone-width. */
export function contentWidthFor(
  pathname: string,
  slug: string,
): "narrow" | "wide" {
  if (!pathname.startsWith(`/w/${slug}/`)) {
    return "narrow";
  }
  const parts = pathname.slice(`/w/${slug}/`.length).split("/");
  // The meeting page (`meetings/<id>`) shows its answers as a table from `md` up.
  const meetingPage =
    parts.length === 2 && parts[0] === "meetings" && UUID.test(parts[1]);
  return WIDE_SECTIONS.includes(parts[0]) || meetingPage ? "wide" : "narrow";
}
