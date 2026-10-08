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
import { publicEnv } from "@/config/public-env";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/shared/api/me";
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
  const items = navItemsFor(role, slug, publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED);
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
          if (item.key === "new" && item.enabled) {
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
          if (item.key === "new") {
            return (
              <li key={item.key} className="-mt-6">
                <button
                  type="button"
                  aria-disabled="true"
                  aria-describedby="new-meeting-soon"
                  className="flex flex-col items-center gap-1 opacity-60"
                >
                  <Sticker
                    tone="primary"
                    className="size-14 rounded-full [&_svg]:size-7"
                  >
                    <Glyph weight="bold" />
                  </Sticker>
                  <span className="sr-only">{t("new")}</span>
                </button>
                <span id="new-meeting-soon" className="sr-only">
                  {t("soon")}
                </span>
              </li>
            );
          }
          const active = isActive(item);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-14 flex-col items-center gap-0.5 rounded-control px-2 py-1 text-xs font-bold",
                  active ? "bg-fill-primary text-on-fill" : "text-ink",
                )}
              >
                <Glyph weight="bold" aria-hidden className="size-6" />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
