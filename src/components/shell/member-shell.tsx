"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/config/app";
import { useMe } from "@/hooks/use-me";
import { homeWorkspaceSlug } from "@/lib/post-sign-in";
import { UserMenu } from "./user-menu";

/**
 * Shell of the member pages (`/invites`, `/account`; spec §7.4): the logo home, a way back to a
 * workspace for people who have one, and the avatar menu.
 */
export function MemberShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const me = useMe();
  if (!me.data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  const slug = homeWorkspaceSlug(me.data);
  return (
    <div className="min-h-dvh pb-12">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-background px-4 py-3">
        <Link href="/invites" className="font-display text-lg">
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-2">
          {slug ? (
            <Button asChild>
              <Link href={`/w/${slug}`}>{t("yourWorkspace")}</Link>
            </Button>
          ) : null}
          <UserMenu me={me.data} />
        </div>
      </header>
      <main className="mx-auto max-w-md p-4">{children}</main>
    </div>
  );
}
