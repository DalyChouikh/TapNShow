import type { WorkspaceRole } from "@/shared/api/me";

/** One bottom-bar slot. */
export type NavItem = {
  key: "home" | "meetings" | "new" | "lists" | "settings";
  href: string;
  enabled: boolean;
};

/**
 * Bottom bar (spec §4 "Hub + center +"). "+" (new meeting) arrives in M4, so it is shown but
 * disabled; Viewers never see it.
 */
export function navItemsFor(role: WorkspaceRole, slug: string): NavItem[] {
  const base = `/w/${slug}`;
  const items: NavItem[] = [
    { key: "home", href: base, enabled: true },
    { key: "meetings", href: `${base}/meetings`, enabled: true },
    { key: "new", href: `${base}/meetings/new`, enabled: false },
    { key: "lists", href: `${base}/lists`, enabled: true },
    { key: "settings", href: `${base}/settings`, enabled: true },
  ];
  return role === "viewer" ? items.filter((item) => item.key !== "new") : items;
}

/** Pages whose content needs more than phone width on larger screens (the roster grid). */
const WIDE_SECTIONS: readonly string[] = ["lists"];

/** "wide" lets a page use the full width from `md` up; every other page stays phone-width. */
export function contentWidthFor(
  pathname: string,
  slug: string,
): "narrow" | "wide" {
  const section = pathname.slice(`/w/${slug}/`.length).split("/")[0];
  return pathname.startsWith(`/w/${slug}/`) && WIDE_SECTIONS.includes(section)
    ? "wide"
    : "narrow";
}
