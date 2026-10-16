"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { AdminWorkspaceRow } from "@/shared/api/admin";
import {
  useWorkspaceRowNumbers,
  WorkspaceStatusPills,
} from "./workspace-status";

/** One workspace as a card on phones (spec §7.19), linking to its page. */
export function WorkspaceRow({ row }: { row: AdminWorkspaceRow }) {
  const t = useTranslations("Admin.workspaces");
  const tReports = useTranslations("Admin.reports");
  const { reportRate, delivered } = useWorkspaceRowNumbers(row);
  const counts = { people: row.contacts, meetings: row.meetings30d };
  return (
    <Link
      href={`/admin/workspaces/${row.id}`}
      className="block rounded-card focus-visible:outline-2"
    >
      <Card className="flex flex-col gap-2 p-3">
        <span className="font-display text-lg break-words">{row.name}</span>
        <WorkspaceStatusPills
          row={row}
          between={
            row.reports7d > 0 ? (
              <Pill tone="warning">
                {reportRate === null
                  ? tReports("count", { reports: row.reports7d })
                  : t("reports", { count: row.reports7d, rate: reportRate })}
              </Pill>
            ) : null
          }
        />
        <span className="text-sm text-muted-ink">
          {delivered === null
            ? t("rowNoEmails", counts)
            : t("row", { ...counts, delivered })}
        </span>
      </Card>
    </Link>
  );
}
