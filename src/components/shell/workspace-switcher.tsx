"use client";

import { CaretDown, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MeResponse } from "@/shared/api/me";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { RoleBadge } from "./role-badge";

/** Header switcher: current workspace + role; menu of all workspaces and "Create workspace". */
export function WorkspaceSwitcher({
  me,
  current,
}: {
  me: MeResponse;
  current: WorkspaceDetails;
}) {
  const t = useTranslations("Shell");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("switcherLabel")}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 text-left"
      >
        <span className="truncate font-display text-lg">{current.name}</span>
        <RoleBadge role={current.myRole} />
        <CaretDown weight="bold" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {me.workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} asChild>
            <Link
              href={`/w/${workspace.slug}`}
              aria-current={
                workspace.slug === current.slug ? "page" : undefined
              }
            >
              <span className="flex-1 truncate">{workspace.name}</span>
              <RoleBadge role={workspace.role} />
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/w/new">
            <Plus weight="bold" aria-hidden />
            {t("createWorkspace")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
