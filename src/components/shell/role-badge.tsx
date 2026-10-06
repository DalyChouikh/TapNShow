"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/shared/api/me";

const ROLE_FILL: Record<WorkspaceRole, string> = {
  owner: "bg-fill-warning",
  admin: "bg-fill-primary",
  viewer: "bg-fill-info",
};

/** Static role label (Chip is a toggle; this is not interactive). */
export function RoleBadge({ role }: { role: WorkspaceRole }) {
  const t = useTranslations("Shell.roles");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
        ROLE_FILL[role],
      )}
    >
      {t(role)}
    </span>
  );
}
