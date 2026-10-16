"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AdminWorkspaceRow } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";
import {
  useWorkspaceRowNumbers,
  WorkspaceStatusPills,
} from "./workspace-status";

const COLUMNS = [
  "name",
  "owner",
  "people",
  "meetings",
  "emails",
  "reports",
  "status",
] as const;
const NUMERIC = new Set<(typeof COLUMNS)[number]>([
  "people",
  "meetings",
  "emails",
  "reports",
]);

function TableRow({ row }: { row: AdminWorkspaceRow }) {
  const t = useTranslations("Admin");
  const { count } = useAdminFormat();
  const { reportRate } = useWorkspaceRowNumbers(row);
  return (
    <tr className="border-t border-dashed border-outline/30 align-top">
      <th scope="row" className="py-3 pr-4 text-left">
        <Link
          href={`/admin/workspaces/${row.id}`}
          className="font-bold break-words underline underline-offset-2"
        >
          {row.name}
        </Link>
      </th>
      <td className="py-3 pr-4 whitespace-nowrap">
        {row.ownerEmail ?? t("noValue")}
      </td>
      <td className="py-3 pr-4 text-right">{count(row.contacts)}</td>
      <td className="py-3 pr-4 text-right">{count(row.meetings30d)}</td>
      <td className="py-3 pr-4 text-right">{count(row.emails30d)}</td>
      <td className="py-3 pr-4 text-right whitespace-nowrap">
        {row.reports7d > 0 && reportRate !== null
          ? t("workspaces.reportsCell", {
              count: count(row.reports7d),
              rate: reportRate,
            })
          : count(row.reports7d)}
      </td>
      <td className="py-3">
        <WorkspaceStatusPills row={row} />
      </td>
    </tr>
  );
}

/** The workspaces list as a table from md up (spec §7.19); each name links to its page. */
export function WorkspaceTable({ rows }: { rows: AdminWorkspaceRow[] }) {
  const t = useTranslations("Admin.workspaces.columns");
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-ink">
          {COLUMNS.map((column) => (
            <th
              key={column}
              scope="col"
              className={cn(
                "pr-4 pb-2 font-bold",
                NUMERIC.has(column) && "text-right",
              )}
            >
              {t(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <TableRow key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}
