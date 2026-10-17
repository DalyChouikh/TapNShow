"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { FILL_CLASS, SVG_FILL_CLASS } from "@/components/ui/fill";
import {
  CHART_THIN_LABELS_BELOW_PX,
  COARSE_POINTER_MEDIA,
} from "@/config/home";
import {
  MIN_TAP_TARGET_PX,
  OUTCOME_TONES,
  type Outcome,
} from "@/design/tokens";
import { useElementWidth } from "@/hooks/use-element-width";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatDate, formatShortDate } from "@/lib/meetings/format";
import { cn } from "@/lib/utils";
import type { InsightsMeeting } from "@/shared/api/insights";

/** Bottom to top: who came, then late, absent and no reply (design §2.4). */
const SEGMENTS: readonly Outcome[] = ["attending", "late", "absent", "noReply"];

// Geometry in CSS pixels: the SVG is drawn at its measured width, so text never scales.
const AXIS_WIDTH = 28;
const PLOT_TOP = 8;
const PLOT_HEIGHT = 150;
const LABEL_HEIGHT = 22;
const HEIGHT = PLOT_TOP + PLOT_HEIGHT + LABEL_HEIGHT;
const BAR_SHARE = 0.6;
const BAR_MAX_WIDTH = 32;
/** Until the first measurement (or where the browser can't measure). */
const FALLBACK_WIDTH = 320;
/** At most this many steps up the axis. */
const AXIS_STEPS = 4;
/** The No reply hatch, for the legend's swatch (the chart draws the same lines). */
const HATCH_CSS =
  "bg-[repeating-linear-gradient(45deg,var(--tn-on-fill)_0_1px,transparent_1px_5px)]";

const total = (meeting: InsightsMeeting) =>
  meeting.attending + meeting.late + meeting.absent + meeting.noReply;

/** A round step (1, 2 or 5 × 10ⁿ) so the axis reaches `max` in at most `AXIS_STEPS` steps. */
function axisStep(max: number): number {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const base of [1, 2, 5]) {
      const step = base * magnitude;
      if (Math.ceil(max / step) <= AXIS_STEPS) {
        return step;
      }
    }
  }
}

/**
 * Home's chart (design §2.4): one stacked bar per counted meeting, oldest to newest, segmented as
 * Came, Late, Absent and No reply in the tiles' tones with ink outlines; No reply is also hatched,
 * so it never depends on colour alone. Each bar names every count and links to its meeting (on a
 * touch screen only where its column fits a finger); dates are in each meeting's own zone, every
 * other one (the newest kept) below 400 px.
 */
export function InsightsChart({
  slug,
  meetings,
}: {
  slug: string;
  meetings: InsightsMeeting[];
}) {
  const t = useTranslations("WorkspaceHome.howItsGoing.chart");
  const [measure, measured] = useElementWidth<HTMLDivElement>();
  const touch = useMediaQuery(COARSE_POINTER_MEDIA);
  const hatchId = `hatch-${useId().replace(/[^\w-]/g, "")}`;
  const width = measured ?? FALLBACK_WIDTH;
  // The tallest bar sets the scale (at least 1, so an all-empty period still draws an axis).
  const tallest = Math.max(1, ...meetings.map(total));
  const step = axisStep(tallest);
  const top = step * Math.ceil(tallest / step);
  const slot = (width - AXIS_WIDTH) / Math.max(meetings.length, 1);
  const barWidth = Math.min(BAR_MAX_WIDTH, slot * BAR_SHARE);
  const y = (value: number) =>
    PLOT_TOP + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT;
  const thin = width < CHART_THIN_LABELS_BELOW_PX;
  // On a touch screen a bar is a link only if its column fits a finger (Owner, 2026-10-17); the
  // meeting stays one tap away in Meetings.
  const linked = !touch || slot >= MIN_TAP_TARGET_PX;
  const newest = meetings.length - 1;
  const ticks = Array.from({ length: top / step + 1 }, (_, n) => n * step);
  return (
    <figure className="flex flex-col gap-2">
      <div ref={measure} className="w-full">
        <svg
          role="group"
          aria-label={t("label")}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block max-w-full overflow-visible"
        >
          <defs>
            <pattern
              id={hatchId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="5"
                className="stroke-on-fill"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          {ticks.map((tick) => (
            <g key={tick} aria-hidden>
              <line
                x1={AXIS_WIDTH}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-muted-ink/30"
                strokeDasharray={tick === 0 ? undefined : "3 3"}
              />
              <text
                x={AXIS_WIDTH - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-ink text-[10px]"
              >
                {tick}
              </text>
            </g>
          ))}
          {meetings.map((meeting, index) => {
            const left = AXIS_WIDTH + index * slot;
            const x = left + (slot - barWidth) / 2;
            const label = t("bar", {
              title: meeting.title,
              date: formatDate(meeting.startsAt, meeting.timezone),
              attending: meeting.attending,
              late: meeting.late,
              absent: meeting.absent,
              noReply: meeting.noReply,
            });
            let base = 0;
            const segments = SEGMENTS.map((key) => {
              const value = meeting[key];
              const from = base;
              base += value;
              if (value === 0) {
                return null;
              }
              const box = {
                x,
                y: y(from + value),
                width: barWidth,
                height: y(from) - y(from + value),
              };
              return (
                <g key={key}>
                  <rect
                    {...box}
                    data-segment={key}
                    className={cn(
                      SVG_FILL_CLASS[OUTCOME_TONES[key]],
                      "stroke-outline",
                    )}
                    strokeWidth="2"
                  />
                  {key === "noReply" ? (
                    <rect {...box} data-hatch={key} fill={`url(#${hatchId})`} />
                  ) : null}
                </g>
              );
            });
            return linked ? (
              <Link
                key={meeting.id}
                href={`/w/${slug}/meetings/${meeting.id}`}
                aria-label={label}
              >
                <title>{label}</title>
                {/* The whole column is the tap target, not just the bar. */}
                <rect
                  x={left}
                  y={PLOT_TOP}
                  width={slot}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                />
                {segments}
              </Link>
            ) : (
              <g key={meeting.id} role="img" aria-label={label}>
                <title>{label}</title>
                {segments}
              </g>
            );
          })}
          <g data-testid="chart-dates" aria-hidden>
            {meetings.map((meeting, index) =>
              thin && (newest - index) % 2 === 1 ? null : (
                <text
                  key={meeting.id}
                  x={AXIS_WIDTH + index * slot + slot / 2}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className="fill-muted-ink text-[10px]"
                >
                  {formatShortDate(meeting.startsAt, meeting.timezone)}
                </text>
              ),
            )}
          </g>
        </svg>
      </div>
      <ul
        aria-label={t("legend")}
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
      >
        {SEGMENTS.map((key) => (
          <li key={key} className="flex items-center gap-1">
            <span
              aria-hidden
              className={cn(
                "size-3 rounded-[3px] border-2 border-outline",
                FILL_CLASS[OUTCOME_TONES[key]],
                key === "noReply" && HATCH_CSS,
              )}
            />
            {t(key)}
          </li>
        ))}
      </ul>
      <figcaption className="text-xs text-muted-ink">{t("note")}</figcaption>
    </figure>
  );
}
