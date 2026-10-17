"use client";

import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { Card } from "@/components/ui/card";
import { useElementWidth } from "@/hooks/use-element-width";
import {
  type ChartUnit,
  groupLabels,
  labelledBars,
  labelStride,
  pointName,
} from "@/lib/admin/chart";
import { axisTicks } from "@/lib/admin/format";
import { cn } from "@/lib/utils";
import type { AdminOverview } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

/** How each bar size is written: under the bar, and on the row below where it changes. */
const DATE_FORMAT: Record<ChartUnit, { bar: string; group: string }> = {
  day: { bar: "d", group: "MMM" },
  week: { bar: "d", group: "MMM" },
  month: { bar: "MMM", group: "yyyy" },
};

/** The room a bar's date label needs (px) before neighbours' labels would touch. */
const LABEL_PX: Record<ChartUnit, number> = { day: 16, week: 16, month: 26 };
/** The room a month or year name under the dates needs (px). */
const GROUP_PX: Record<ChartUnit, number> = { day: 28, week: 28, month: 32 };

/** Keys that move the chosen bar, and by how much (Home and End jump to the ends). */
const STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

/** A share of the axis' top as a CSS percentage (three decimals keep the style stable). */
function percentOf(value: number, top: number): string {
  return `${Math.round((value / top) * 100_000) / 1000}%`;
}

/**
 * Meetings sent in the Overview's period (spec §7.19), drawn with plain HTML and CSS (no chart
 * library): a bar per day, week or month (the period decides), the chosen bar's number leading
 * (the latest by default), the period's total by the title, a clean three-tick scale, the busiest
 * bar labelled, every bar dated (as many as fit on narrow screens; the chosen one always), the
 * month or year written where it changes and fits. A bar the period cuts is named by its days.
 * One slider chooses the bar (a tap or the pointer anywhere on the plot, or the arrow keys); a
 * visually hidden table keeps every number.
 */
export function MeetingsChart({
  series,
  today,
}: {
  series: AdminOverview["series"];
  /** Today's UTC date: a last bar that ends today is still filling ("This week so far"). */
  today: string;
}) {
  const t = useTranslations("Admin.chart");
  const { count, compact } = useAdminFormat();
  const [plot, plotWidth] = useElementWidth<HTMLDivElement>();
  const { unit, points } = series;
  const last = points.length - 1;
  // A new period starts on its latest bar again.
  const seriesKey = `${unit}:${points[0]?.start}:${points.length}`;
  const [pick, setPick] = useState({ key: seriesKey, index: last });
  const chosen = pick.key === seriesKey ? pick.index : last;
  const choose = (index: number) => {
    const next = Math.min(last, Math.max(0, index));
    // A pointer moving within one bar changes nothing: no render.
    if (next !== chosen) {
      setPick({ key: seriesKey, index: next });
    }
  };

  const total = points.reduce((sum, point) => sum + point.meetings, 0);
  const peak = Math.max(0, ...points.map((point) => point.meetings));
  const peakIndex =
    peak > 0 ? points.findLastIndex((point) => point.meetings === peak) : -1;
  const ticks = axisTicks(peak);
  const top = ticks[2];
  const dates = points.map((point) => parseISO(point.start));
  const live = points[last]?.end === today;
  const nameOf = (index: number) => {
    if (live && index === last) {
      return t(`current.${unit}`);
    }
    const name = pointName(points[index], unit);
    return "date" in name ? t("point.date", name) : t("point.range", name);
  };
  const labelled = labelledBars(
    points.length,
    chosen,
    labelStride(points.length, plotWidth, LABEL_PX[unit]),
  );
  const groups = groupLabels(
    dates.map((date) => format(date, DATE_FORMAT[unit].group)),
    plotWidth,
    GROUP_PX[unit],
  );
  // The busiest bar's number sits over it but never past the plot's edges: placed at the bar's
  // centre and pulled back by the same share of its own width.
  const peakAt = percentOf(peakIndex + 0.5, points.length);
  const columns = {
    gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
  };
  const current = points[chosen];

  const chooseAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) {
      choose(
        Math.floor(((event.clientX - box.left) / box.width) * points.length),
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key in STEPS
            ? chosen + STEPS[event.key]
            : null;
    if (next !== null) {
      event.preventDefault();
      choose(next);
    }
  };

  if (!current) {
    return null;
  }
  return (
    <Card
      as="section"
      aria-labelledby="admin-chart"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="admin-chart" className="font-bold">
          {t(`title.${unit}`)}
        </h2>
        <p className="text-sm text-muted-ink">{t("total", { count: total })}</p>
      </div>
      {/* The slider announces the same words; this is the eye's readout. */}
      <p
        data-testid="chart-readout"
        aria-hidden="true"
        className="flex flex-wrap items-baseline gap-x-2"
      >
        <span className="font-display text-3xl">{count(current.meetings)}</span>
        <span className="font-bold">
          {t("unit", { count: current.meetings })}
        </span>
        <span className="text-sm text-muted-ink">{nameOf(chosen)}</span>
      </p>
      {total === 0 ? (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <div
          aria-hidden="true"
          className="relative h-40 shrink-0 text-right text-xs text-muted-ink tabular-nums"
        >
          {/* Sizes the scale's column to its widest number. */}
          <span className="invisible flex h-0 flex-col">
            {ticks.map((tick) => (
              <span key={tick}>{compact(tick)}</span>
            ))}
          </span>
          {[...ticks].reverse().map((tick) => (
            <span
              key={tick}
              data-tick
              className="absolute right-0 -translate-y-1/2"
              style={{ top: percentOf(top - tick, top) }}
            >
              {compact(tick)}
            </span>
          ))}
        </div>
        <div ref={plot} className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label={t(`choose.${unit}`)}
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={chosen}
            aria-valuetext={t("valueText", {
              name: nameOf(chosen),
              count: current.meetings,
            })}
            onKeyDown={onKeyDown}
            onPointerDown={chooseAt}
            onPointerMove={chooseAt}
            className="relative h-40 cursor-pointer touch-pan-y rounded-control outline-offset-4 focus-visible:outline-2 focus-visible:outline-outline"
          >
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 border-t",
                  tick === 0 ? "border-outline" : "border-outline/15",
                )}
                style={{ top: percentOf(top - tick, top) }}
              />
            ))}
            <div
              aria-hidden="true"
              className="absolute inset-0 grid"
              style={columns}
            >
              {points.map((point, index) => (
                <div
                  key={point.start}
                  className={cn(
                    "flex h-full items-end justify-center rounded-t-control",
                    index === chosen && "bg-outline/10",
                  )}
                >
                  {point.meetings > 0 ? (
                    <div
                      data-bar
                      className="w-3/4 max-w-6 shrink-0 rounded-t-[4px] border-2 border-b-0 border-outline bg-fill-primary"
                      style={{ height: percentOf(point.meetings, top) }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            {peakIndex >= 0 ? (
              <span
                data-peak
                aria-hidden="true"
                className="absolute mb-0.5 text-xs font-bold whitespace-nowrap tabular-nums"
                style={{
                  left: peakAt,
                  bottom: percentOf(peak, top),
                  transform: `translateX(-${peakAt})`,
                }}
              >
                {count(peak)}
              </span>
            ) : null}
          </div>
          <div
            aria-hidden="true"
            className="grid text-xs tabular-nums"
            style={columns}
          >
            {points.map((point, index) => (
              <span
                key={point.start}
                className={cn(
                  "justify-self-center whitespace-nowrap",
                  index === chosen ? "font-bold text-ink" : "text-muted-ink",
                )}
              >
                {labelled.has(index) ? (
                  <span data-bar-label>
                    {format(dates[index], DATE_FORMAT[unit].bar)}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="grid text-xs text-muted-ink"
            style={columns}
          >
            {points.map((point, index) => (
              <span
                key={point.start}
                className="justify-self-start whitespace-nowrap"
              >
                {groups[index] ? (
                  <span data-group-label>{groups[index]}</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">{t(`column.${unit}`)}</th>
            <th scope="col">{t("meetings")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.start}>
              <th scope="row">{nameOf(index)}</th>
              <td>{count(point.meetings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
