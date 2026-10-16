import {
  Buildings,
  Flag,
  Gauge,
  ListBullets,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";

/** One admin tab (spec §7.19). */
export type AdminNavItem = {
  key: "overview" | "workspaces" | "reports" | "admins" | "log";
  href: string;
  glyph: Icon;
  /** The `Admin.nav` key of a shorter label for the phone bar, where five must fit 320 px. */
  shortKey?: "workspacesShort";
};

/** The five tabs, in order. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: "overview", href: "/admin", glyph: Gauge },
  {
    key: "workspaces",
    href: "/admin/workspaces",
    glyph: Buildings,
    shortKey: "workspacesShort",
  },
  { key: "reports", href: "/admin/reports", glyph: Flag },
  { key: "admins", href: "/admin/admins", glyph: UsersThree },
  { key: "log", href: "/admin/log", glyph: ListBullets },
];

/** The tab a path belongs to (Overview only for `/admin` itself and anything unknown). */
export function activeAdminItem(pathname: string): AdminNavItem["key"] {
  const match = ADMIN_NAV.slice(1).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.key ?? "overview";
}
