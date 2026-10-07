"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ME_QUERY_KEY, useMe } from "@/hooks/use-me";
import { useWorkspace } from "@/hooks/use-workspace";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { okSchema } from "@/shared/api/common";
import { BottomBar } from "./bottom-bar";
import { contentWidthFor } from "./nav-items";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Organizer shell for `/w/[slug]/*`: header, content, bottom bar (spec §4, §10). */
export function WorkspaceShell({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const t = useTranslations("Shell");
  const queryClient = useQueryClient();
  const me = useMe();
  const workspace = useWorkspace(slug);
  const pathname = usePathname();
  const remember = useMutation({
    mutationFn: (lastWorkspaceId: string) =>
      apiRequest("/api/me", {
        method: "PATCH",
        body: { lastWorkspaceId },
        schema: okSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
  const workspaceId = workspace.data?.id;
  const shouldRemember = Boolean(
    workspaceId && me.data && me.data.lastWorkspaceSlug !== slug,
  );
  const { mutate: rememberWorkspace } = remember;
  const rememberedId = useRef<string | null>(null);
  useEffect(() => {
    if (shouldRemember && workspaceId && rememberedId.current !== workspaceId) {
      rememberedId.current = workspaceId;
      rememberWorkspace(workspaceId);
    }
  }, [shouldRemember, workspaceId, rememberWorkspace]);

  if (
    workspace.error instanceof ApiClientError &&
    workspace.error.status === 404
  ) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
        <Card as="section" className="flex flex-col gap-3">
          <h1 className="font-display text-2xl">{t("notFoundTitle")}</h1>
          <p className="text-muted-ink">{t("notFoundBody")}</p>
          <Button asChild tone="primary">
            <Link href="/welcome">{t("backHome")}</Link>
          </Button>
        </Card>
      </main>
    );
  }
  if (!workspace.data || !me.data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b-[length:var(--tn-border-width)] border-outline bg-background px-4 py-3">
        <WorkspaceSwitcher me={me.data} current={workspace.data} />
        <UserMenu me={me.data} />
      </header>
      <main
        className={cn(
          "mx-auto max-w-md p-4",
          contentWidthFor(pathname, slug) === "wide" && "md:max-w-5xl",
        )}
      >
        {children}
      </main>
      <BottomBar role={workspace.data.myRole} slug={slug} />
    </div>
  );
}
