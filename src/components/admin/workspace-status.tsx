"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Pill } from "@/components/ui/pill";
import type { FillTone } from "@/design/tokens";
import { reportPercent } from "@/lib/admin/format";
import type { AdminWorkspaceRow } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

type StatusKey =
  "suspended" | "sending" | "noSender" | "broken" | "sheetOn" | "sheetPaused";

const SENDER: Record<
  AdminWorkspaceRow["sender"],
  { key: StatusKey; tone: FillTone }
> = {
  active: { key: "sending", tone: "success" },
  none: { key: "noSender", tone: "neutral" },
  broken: { key: "broken", tone: "warning" },
};

const SHEET: Record<
  AdminWorkspaceRow["sheet"],
  { key: StatusKey; tone: FillTone } | null
> = {
  off: null,
  on: { key: "sheetOn", tone: "info" },
  paused: { key: "sheetPaused", tone: "warning" },
};

/**
 * A workspace's state as pills (the list's cards and table): suspended, then `between` (the
 * cards put the reports there), then the sender and the sheet (nothing when it is off).
 */
export function WorkspaceStatusPills({
  row,
  between,
}: {
  row: Pick<AdminWorkspaceRow, "suspended" | "sender" | "sheet">;
  between?: ReactNode;
}) {
  const t = useTranslations("Admin.workspaces.status");
  const sheet = SHEET[row.sheet];
  const pills = [SENDER[row.sender], ...(sheet ? [sheet] : [])];
  return (
    <span className="flex flex-wrap gap-1.5">
      {row.suspended ? <Pill tone="danger">{t("suspended")}</Pill> : null}
      {between}
      {pills.map((pill) => (
        <Pill key={pill.key} tone={pill.tone}>
          {t(pill.key)}
        </Pill>
      ))}
    </span>
  );
}

/**
 * The numbers a workspaces-list row shows, formatted (shared by the cards and the table). No
 * report rate when nobody was emailed in the window, no delivered line when nothing was sent.
 */
export function useWorkspaceRowNumbers(row: AdminWorkspaceRow) {
  const { percent, delivered } = useAdminFormat();
  return {
    reportRate:
      row.people7d > 0
        ? percent(reportPercent(row.reports7d, row.people7d))
        : null,
    delivered:
      row.emails30d > 0
        ? delivered(row.emails30d - row.failed30d, row.emails30d)
        : null,
  };
}
