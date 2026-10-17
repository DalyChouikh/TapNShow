import {
  addDays,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ADMIN_PERIOD_MAX_DAYS, type AdminPeriod } from "@/shared/api/admin";

/** The Overview's period presets, in the switch's order (custom comes after them). */
export const ADMIN_PERIOD_PRESETS = ["7d", "30d", "90d", "12m"] as const;
/** One of the presets. */
export type AdminPeriodPreset = (typeof ADMIN_PERIOD_PRESETS)[number];
/** One preset, or a range the admin picked. */
export type AdminPeriodChoice = AdminPeriodPreset | "custom";
/**
 * What the Overview shows: a preset (its days follow today, so an Overview left open past
 * midnight UTC moves on with it) or the days the admin picked.
 */
export type AdminPeriodSelection =
  { preset: AdminPeriodPreset } | { preset: "custom"; period: AdminPeriod };

/** The preset the Overview opens on. */
export const DEFAULT_ADMIN_PERIOD: AdminPeriodPreset = "30d";

const DAY = "yyyy-MM-dd";
const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

/** Today's UTC date (`yyyy-MM-dd`): the admin figures count UTC days. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A preset's UTC days, ending today; 12 months start on the first of the month 11 months back. */
export function presetPeriod(
  preset: AdminPeriodPreset,
  today: string,
): AdminPeriod {
  const end = parseISO(today);
  const start =
    preset === "12m"
      ? startOfMonth(subMonths(end, 11))
      : addDays(end, 1 - PRESET_DAYS[preset]);
  return { from: format(start, DAY), to: today };
}

/** `yyyy-MM-dd` that names a real calendar day. */
function isDay(value: string | null): value is string {
  return (
    value !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isValid(parseISO(value)) &&
    format(parseISO(value), DAY) === value
  );
}

/**
 * Whether a picked range is one the Overview accepts: real days, the start on or before the end,
 * ending today at the latest, at most `ADMIN_PERIOD_MAX_DAYS` long (the database's own rule).
 */
export function isValidPeriod(
  period: { from: string | null; to: string | null },
  today: string,
): boolean {
  const { from, to } = period;
  return (
    isDay(from) &&
    isDay(to) &&
    from <= to &&
    to <= today &&
    differenceInCalendarDays(parseISO(to), parseISO(from)) <
      ADMIN_PERIOD_MAX_DAYS
  );
}

/** The period the address names (`?period=` or `?from=&to=`), else the default. */
export function periodFromParams(
  params: URLSearchParams,
  today: string,
): AdminPeriodSelection {
  const preset = ADMIN_PERIOD_PRESETS.find(
    (choice) => choice === params.get("period"),
  );
  if (preset) {
    return { preset };
  }
  const range = { from: params.get("from"), to: params.get("to") };
  if (isValidPeriod(range, today) && range.from && range.to) {
    return { preset: "custom", period: { from: range.from, to: range.to } };
  }
  return { preset: DEFAULT_ADMIN_PERIOD };
}

/** The UTC days a selection covers today. */
export function selectedPeriod(
  selection: AdminPeriodSelection,
  today: string,
): AdminPeriod {
  return selection.preset === "custom"
    ? selection.period
    : presetPeriod(selection.preset, today);
}

/** The address' query for a selection (empty for the default). */
export function periodParams(selection: AdminPeriodSelection): string {
  if (selection.preset === DEFAULT_ADMIN_PERIOD) {
    return "";
  }
  return new URLSearchParams(
    selection.preset === "custom"
      ? selection.period
      : { period: selection.preset },
  ).toString();
}
