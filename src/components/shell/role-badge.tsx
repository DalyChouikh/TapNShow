"use client";

import { useTranslations } from "next-intl";
import { Pill } from "@/components/ui/pill";
import type { FillTone } from "@/design/tokens";
import type { WorkspaceRole } from "@/shared/api/me";

const ROLE_TONE: Record<WorkspaceRole, FillTone> = {
  owner: "warning",
  admin: "primary",
  viewer: "info",
};

/** Static role label (Chip is a toggle; this is not interactive). */
export function RoleBadge({ role }: { role: WorkspaceRole }) {
  const t = useTranslations("Shell.roles");
  return (
    <Pill tone={ROLE_TONE[role]} className="inline-flex shrink-0">
      {t(role)}
    </Pill>
  );
}
