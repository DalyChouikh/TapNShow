"use client";

import { useTranslations } from "next-intl";
import { FILL_CLASS } from "@/components/ui/fill";
import { OUTCOME_TONES } from "@/design/tokens";
import { cn } from "@/lib/utils";
import type { MeetingResults, PeopleFilter } from "@/shared/api/responses";

type Tile = {
  filter: Exclude<PeopleFilter, "all" | "not_delivered">;
  count: number;
  fill: string;
};

/** Columns on wide screens per tile count (whole class names, so Tailwind sees each one). */
const WIDE_COLUMNS: Record<number, string> = {
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
};

/** The outlined tile box; buttons add their press motion on top. */
const TILE_CLASS =
  "flex min-h-11 flex-col items-start rounded-control border-[length:var(--tn-border-width)] border-outline px-3 py-2 text-left text-on-fill shadow-brutal";

/**
 * Count tiles (spec §7.7, layout decided 2026-10-08): attendance shows Going / Late / Absent /
 * No reply, RSVP Going / Not going / No reply; announcements only say how many people asked for a
 * calendar invite. With `onFilter` they filter the list below (a second tap on the pressed tile
 * shows everyone); without it they are plain boxes (Home).
 */
export function ResultTiles({
  results,
  filter = "all",
  onFilter,
}: {
  results: MeetingResults;
  filter?: PeopleFilter;
  onFilter?: (filter: PeopleFilter) => void;
}) {
  const t = useTranslations("MeetingPage.results");
  const { answers } = results;
  if (results.responseMode === "announcement") {
    return (
      <p className="font-bold">
        {t("calendarRequested", { count: answers.calendarRequested })}
      </p>
    );
  }
  const answerTiles: Tile[] =
    results.responseMode === "rsvp"
      ? [
          {
            filter: "attending",
            count: answers.attending,
            fill: FILL_CLASS[OUTCOME_TONES.attending],
          },
          {
            // Not going counts as Absent.
            filter: "not_attending",
            count: answers.notAttending,
            fill: FILL_CLASS[OUTCOME_TONES.absent],
          },
          {
            filter: "no_reply",
            count: answers.noReply,
            fill: FILL_CLASS[OUTCOME_TONES.noReply],
          },
        ]
      : [
          {
            filter: "attending",
            count: answers.attending,
            fill: FILL_CLASS[OUTCOME_TONES.attending],
          },
          {
            filter: "late",
            count: answers.late,
            fill: FILL_CLASS[OUTCOME_TONES.late],
          },
          {
            filter: "absent",
            count: answers.absent,
            fill: FILL_CLASS[OUTCOME_TONES.absent],
          },
          {
            filter: "no_reply",
            count: answers.noReply,
            fill: FILL_CLASS[OUTCOME_TONES.noReply],
          },
        ];
  // People asked to confirm again after a time change (spec §7.5), only while there are some.
  const tiles: Tile[] =
    answers.toReconfirm > 0
      ? [
          ...answerTiles,
          {
            filter: "to_reconfirm",
            count: answers.toReconfirm,
            fill: "bg-fill-warning",
          },
        ]
      : answerTiles;
  return (
    <div
      role="group"
      aria-label={t("tilesLabel")}
      className={cn(
        "grid grid-cols-2 gap-3",
        WIDE_COLUMNS[tiles.length] ?? "md:grid-cols-4",
      )}
    >
      {tiles.map((tile) => {
        const content = (
          <>
            <span className="text-sm font-bold">{t(tile.filter)}</span>
            <span className="font-display text-2xl">{tile.count}</span>
          </>
        );
        if (!onFilter) {
          return (
            <div key={tile.filter} className={cn(TILE_CLASS, tile.fill)}>
              {content}
            </div>
          );
        }
        const pressed = filter === tile.filter;
        return (
          <button
            key={tile.filter}
            type="button"
            aria-pressed={pressed}
            aria-label={`${t(tile.filter)} ${tile.count}`}
            onClick={() => onFilter(pressed ? "all" : tile.filter)}
            className={cn(
              TILE_CLASS,
              "transition-[transform,box-shadow] duration-300 ease-spring motion-reduce:transition-none",
              tile.fill,
              pressed
                ? "translate-y-0.5 shadow-none outline-3 outline-offset-2 outline-outline"
                : "hover:-translate-y-0.5",
            )}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
