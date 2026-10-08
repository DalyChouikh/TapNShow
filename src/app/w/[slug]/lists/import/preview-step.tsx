"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import { LIST_FILL } from "@/components/forms/list-tag";
import type {
  ImportOutcome,
  ImportResult,
  ImportRowResult,
  Roster,
} from "@/shared/api/roster";

type Tile = ImportOutcome | "merged";
const TILES: readonly Tile[] = [
  "new",
  "updated",
  "unchanged",
  "merged",
  "invalid",
];
const TONE: Record<Tile, FillTone> = {
  new: "success",
  updated: "info",
  unchanged: "neutral",
  merged: "warning",
  invalid: "danger",
};
const ROW_ESTIMATE_PX = 64;
const OVERSCAN = 8;

const matches = (tile: Tile | null, row: ImportRowResult): boolean =>
  tile === null ||
  (tile === "merged" ? row.mergedRows.length > 0 : row.outcome === tile);

/** Step 3: the server's dry run — counts first (tap to filter), new lists, then every row with its reason. */
export function PreviewStep({
  result,
  limits,
}: {
  result: ImportResult;
  limits: Roster["limits"];
}) {
  const t = useTranslations("ListsImport");
  const [tile, setTile] = useState<Tile | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // "Merged duplicates" counts absorbed input rows, so that filter lists one line per absorbed row (#119).
  const mergedLines =
    tile === "merged"
      ? result.rows.flatMap((row) =>
          row.mergedRows.map((absorbed) =>
            t("mergedInto", { row: absorbed, into: row.row, email: row.email }),
          ),
        )
      : [];
  const rows =
    tile === "merged" ? [] : result.rows.filter((row) => matches(tile, row));
  const count = tile === "merged" ? mergedLines.length : rows.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: ROW_ESTIMATE_PX * OVERSCAN },
  });

  const detail = (row: ImportRowResult): string | null => {
    if (row.reason) {
      return t(`reasons.${row.reason}`, { email: row.email });
    }
    const parts = [
      row.previousName && row.fullName
        ? t("renamed", { from: row.previousName, to: row.fullName })
        : null,
      row.addedLists.length
        ? t("addedLists", { lists: row.addedLists.join(", ") })
        : null,
      row.mergedRows.length
        ? t("mergedRows", {
            rows: row.mergedRows.length,
            list: row.mergedRows.join(", "),
          })
        : null,
    ].filter((part): part is string => part !== null);
    return parts.length ? parts.join(" · ") : null;
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {TILES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tile === key}
            onClick={() => setTile(tile === key ? null : key)}
            className={cn(
              "flex flex-col items-start rounded-control border-[length:var(--tn-border-width)] border-outline px-3 py-2 text-left text-sm font-bold text-on-fill shadow-brutal-sm aria-pressed:translate-y-0.5 aria-pressed:shadow-none",
              LIST_FILL[TONE[key]],
              key === "invalid" && "col-span-2",
            )}
          >
            <span className="font-display text-xl">{result.summary[key]}</span>{" "}
            {t(`tiles.${key}`)}
          </button>
        ))}
      </div>
      {tile ? (
        <button
          type="button"
          onClick={() => setTile(null)}
          className="min-h-11 self-start text-sm font-bold underline"
        >
          {t("showAll")}
        </button>
      ) : null}
      {result.newLists.length ? (
        <p className="flex flex-wrap items-center gap-1 text-sm">
          <span className="font-bold">{t("newLists")}</span>
          {result.newLists.map((name) => (
            <span
              key={name}
              className="rounded-full border-2 border-outline bg-fill-success px-2 text-xs font-bold text-on-fill"
            >
              {name}
            </span>
          ))}
        </p>
      ) : null}
      {result.limitExceeded ? (
        <p
          role="alert"
          className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 font-bold text-on-fill"
        >
          {result.limitExceeded === "contacts"
            ? t("limitContacts", { max: limits.contactsMax })
            : t("limitLists", { max: limits.listsMax })}
        </p>
      ) : null}
      <div
        ref={setScroller}
        className="max-h-[40dvh] min-h-24 overflow-y-auto rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface"
      >
        <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            if (tile === "merged") {
              return (
                <li
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full border-b-2 border-dashed border-fill-neutral px-3 py-2 text-sm break-all"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {mergedLines[item.index]}
                </li>
              );
            }
            const row = rows[item.index];
            const text = detail(row);
            return (
              <li
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full border-b-2 border-dashed border-fill-neutral px-3 py-2 text-sm"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md border-2 border-outline px-1 text-xs font-bold text-on-fill",
                      LIST_FILL[TONE[row.outcome]],
                    )}
                  >
                    {t(`tags.${row.outcome}`)}
                  </span>
                  <span className="text-muted-ink">
                    {t("rowLabel", { row: row.row })}
                  </span>
                  <span className="min-w-0 font-bold break-words">
                    {row.fullName ?? row.email}
                  </span>
                </p>
                {text ? (
                  <p className="break-all text-muted-ink">{text}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
