"use client";

import {
  CalendarDots,
  GearSix,
  House,
  ListBullets,
  Plus,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";
import type { WorkspaceRole } from "@/shared/api/me";
import { NavLink } from "./nav-link";
import { navItemsFor, type NavItem } from "./nav-items";

const ICONS: Record<NavItem["key"], Icon> = {
  home: House,
  meetings: CalendarDots,
  new: Plus,
  lists: ListBullets,
  settings: GearSix,
};

/** Fixed bottom navigation with the center "+" (spec §4). */
export function BottomBar({
  role,
  slug,
}: {
  role: WorkspaceRole;
  slug: string;
}) {
  const t = useTranslations("Shell.nav");
  const pathname = usePathname();
  const items = navItemsFor(role, slug);
  const isActive = (item: NavItem) =>
    item.key === "home"
      ? pathname === item.href
      : pathname.startsWith(item.href);

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t-[length:var(--tn-border-width)] border-outline bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md items-end justify-around px-2 pt-2 pb-2">
        {items.map((item) => {
          const Glyph = ICONS[item.key];
          if (item.key === "new") {
            return (
              <li key={item.key} className="-mt-6">
                <Link
                  href={item.href}
                  aria-label={t("new")}
                  className="flex flex-col items-center gap-1 rounded-full"
                >
                  <Sticker
                    tone="primary"
                    className="size-14 rounded-full [&_svg]:size-7"
                  >
                    <Glyph weight="bold" />
                  </Sticker>
                </Link>
              </li>
            );
          }
          return (
            <li key={item.key}>
              <NavLink
                href={item.href}
                label={t(item.key)}
                glyph={Glyph}
                active={isActive(item)}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
