"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ExportMenu } from "@/components/forms/export-menu";
import { PeriodChips } from "@/components/forms/period-chips";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ROSTER_GRID_MEDIA } from "@/config/roster";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAttendance } from "@/hooks/use-results";
import { usePeriod } from "@/lib/responses/use-period";
import { filterContacts, type ListFilter } from "@/lib/roster/filter-contacts";
import { cn } from "@/lib/utils";
import type { Contact, Roster } from "@/shared/api/roster";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { ListChips } from "./list-chips";
import { useExportAttendance } from "./use-export-attendance";

type SortKey = "name" | "attending" | "late" | "absent" | "noReply";
type Sort = { key: SortKey; dir: "asc" | "desc" };
type Row = Contact &
  Record<Exclude<SortKey, "name">, number> & { invited: number };

const COUNTS = ["attending", "late", "absent", "noReply"] as const;
const PILL = {
  late: "bg-fill-warning",
  absent: "bg-fill-danger",
  noReply: "bg-fill-neutral",
} as const;

function sortRows(rows: Row[], sort: Sort): Row[] {
  const byName = (a: Row, b: Row) => a.fullName.localeCompare(b.fullName);
  return [...rows].sort((a, b) => {
    const order =
      sort.key === "name" ? byName(a, b) : a[sort.key] - b[sort.key];
    const directed = sort.dir === "asc" ? order : -order;
    return directed !== 0 ? directed : byName(a, b);
  });
}

/**
 * Lists → Attendance (spec §7.7): everyone's Going / Late / Absent / No reply for a period,
 * filtered by the list chips and sortable (No reply first by default). Loaded at once like the
 * roster (cap 2,000); rows skip off-screen rendering with `content-visibility`.
 */
export function AttendanceView({
  workspace,
  roster,
  onOpenContact,
}: {
  workspace: WorkspaceDetails;
  roster: Roster;
  onOpenContact: (contact: Contact) => void;
}) {
  const t = useTranslations("Attendance");
  const wide = useMediaQuery(ROSTER_GRID_MEDIA);
  const period = usePeriod(workspace.timezone);
  const summary = useAttendance(workspace.slug, period.range);
  const exportAttendance = useExportAttendance(
    workspace.slug,
    roster,
    period.range,
  );
  const [listId, setListId] = useState<ListFilter>(null);
  const [sort, setSort] = useState<Sort>({ key: "noReply", dir: "desc" });
  const counts = new Map(summary.data?.rows.map((row) => [row.contactId, row]));
  const rows = sortRows(
    filterContacts(roster.contacts, { query: "", listId }).map((contact) => {
      const row = counts.get(contact.id);
      return {
        ...contact,
        invited: row?.invited ?? 0,
        attending: row?.attending ?? 0,
        late: row?.late ?? 0,
        absent: row?.absent ?? 0,
        noReply: row?.noReply ?? 0,
      };
    }),
    sort,
  );
  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  const noListCount = roster.contacts.filter(
    (c) => c.listIds.length === 0,
  ).length;
  // The sheet gets the roster's own contact, not the row with its counts.
  const open = (row: Row) =>
    onOpenContact(roster.contacts.find((c) => c.id === row.id) ?? row);

  return (
    <div className="flex flex-col gap-3">
      <PeriodChips
        value={period.period}
        onChange={period.setPeriod}
        custom={period.custom}
        onCustomChange={period.setCustom}
        today={period.today}
      />
      <ListChips
        lists={roster.lists}
        total={roster.contacts.length}
        noListCount={noListCount}
        selectedListId={listId}
        onSelect={setListId}
      />
      {!summary.data ? (
        <Skeleton className="h-64 w-full" />
      ) : summary.data.meetings === 0 ? (
        <p className="py-6 text-center text-muted-ink">{t("empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-ink">
              {t("meetings", { count: summary.data.meetings })}
            </p>
            <ExportMenu
              onExport={(format) =>
                exportAttendance(
                  format,
                  rows.map((row) => ({ ...row, contactId: row.id })),
                )
              }
            />
          </div>
          {wide ? (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-[length:var(--tn-border-width)] border-outline">
                  {(["name", ...COUNTS] as const).map((key) => (
                    <th
                      key={key}
                      aria-sort={
                        sort.key === key
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={cn(
                        "py-1",
                        key !== "name" && "w-28 text-right",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(key)}
                        className="min-h-11 font-bold underline-offset-4 hover:underline"
                      >
                        {t(`columns.${key}`)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => open(row)}
                    className="cursor-pointer border-b border-dashed border-outline/30 [contain-intrinsic-size:auto_2.5rem] [content-visibility:auto] last:border-b-0 hover:bg-fill-neutral/40"
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          open(row);
                        }}
                        className="font-bold break-words underline-offset-4 hover:underline"
                      >
                        {row.fullName}
                      </button>
                    </td>
                    {COUNTS.map((key) => (
                      <td key={key} className="py-2 text-right tabular-nums">
                        {row[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <SegmentedControl
                compact
                label={t("sortBy")}
                value={sort.key}
                onValueChange={(key) =>
                  setSort({
                    key: COUNTS.find((k) => k === key) ?? "name",
                    dir: key === "name" ? "asc" : "desc",
                  })
                }
                options={(["noReply", "late", "absent", "name"] as const).map(
                  (key) => ({ value: key, label: t(`columns.${key}`) }),
                )}
              />
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="[contain-intrinsic-size:auto_4rem] [content-visibility:auto]"
                  >
                    <button
                      type="button"
                      onClick={() => open(row)}
                      className="flex min-h-11 w-full flex-col items-start gap-1 border-b border-dashed border-outline/30 py-2 text-left"
                    >
                      <span className="font-bold break-words">
                        {row.fullName}
                      </span>
                      <span className="flex flex-wrap gap-1.5 text-xs font-bold">
                        {(["late", "absent", "noReply"] as const).map((key) => (
                          <span
                            key={key}
                            className={cn(
                              "rounded-full border-2 border-outline px-2 text-on-fill",
                              PILL[key],
                            )}
                          >
                            {t(`columns.${key}`)} {row[key]}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
