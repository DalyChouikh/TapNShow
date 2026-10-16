"use client";

import { ArrowLeft, ShieldStar } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { NotFoundView } from "@/components/errors/not-found-view";
import { NavLink } from "@/components/shell/nav-link";
import { UserMenu } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useAdminAccessCheck } from "@/hooks/use-admin";
import { useMe } from "@/hooks/use-me";
import { ADMIN_NAV, activeAdminItem } from "./admin-nav";

/**
 * The admin area's frame (spec §7.19): a header, then the five tabs, a bottom bar on phones and a
 * side menu from md up (one landmark). Who may see it is `GET /api/me`'s `platformRole`; anyone
 * else gets the not-found view, and the API answers them 404 for every call.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const me = useMe();
  useAdminAccessCheck();
  if (!me.data) {
    return (
      <main
        aria-busy="true"
        className="mx-auto flex max-w-md flex-col gap-4 p-4"
      >
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (!me.data.platformRole) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
        <Card as="section" className="flex flex-col gap-4">
          <NotFoundView signedIn />
        </Card>
      </main>
    );
  }
  const active = activeAdminItem(pathname);
  return (
    <div className="min-h-dvh pb-28 md:pb-0">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-background px-4 py-3">
        <Sticker tone="danger">
          <ShieldStar weight="bold" />
        </Sticker>
        <p className="min-w-0 flex-1 truncate font-display text-lg">
          {t("title")}
        </p>
        <Button asChild>
          <Link href="/welcome">
            <ArrowLeft weight="bold" aria-hidden className="size-4" />
            {t("backToApp")}
          </Link>
        </Button>
        <UserMenu me={me.data} />
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 p-4 md:py-6">
        <nav
          aria-label={t("nav.label")}
          className="fixed inset-x-0 bottom-0 z-40 border-t-[length:var(--tn-border-width)] border-outline bg-surface pb-[env(safe-area-inset-bottom)] md:sticky md:top-24 md:z-auto md:h-fit md:w-48 md:shrink-0 md:border-0 md:bg-transparent md:pb-0"
        >
          <ul className="mx-auto flex max-w-md items-end justify-around px-1 py-2 md:flex-col md:items-stretch md:gap-1 md:p-0">
            {ADMIN_NAV.map((item) => (
              <li key={item.key}>
                <NavLink
                  href={item.href}
                  label={t(`nav.${item.key}`)}
                  shortLabel={
                    item.shortKey ? t(`nav.${item.shortKey}`) : undefined
                  }
                  glyph={item.glyph}
                  active={item.key === active}
                  className="px-1 md:flex-row md:gap-3 md:px-3 md:text-sm"
                />
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
