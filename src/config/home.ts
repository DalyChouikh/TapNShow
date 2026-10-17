/**
 * Home's chart shows this many counted meetings of the period, the newest (workspace Home design
 * §2.4). SQL twin: `limit 12` in `private.workspace_insights`; home-insights.db.test.ts pins the pair.
 */
export const INSIGHTS_CHART_MEETINGS = 12;

/**
 * "Often missing" lists at most this many members (design §2.5). SQL twin: `limit 3` in
 * `private.workspace_insights`; home-insights.db.test.ts pins the pair.
 */
export const OFTEN_MISSING_PEOPLE = 3;

/** From Tailwind's `lg`, Home lays out two columns, about 3 : 2 (design §2.7). */
export const HOME_TWO_COLUMNS_MEDIA = "(min-width: 1024px)";

/** Where the greeting's parts of the day start, in hours of the browser's clock (design §2.1). */
export const GREETING_HOURS = {
  morning: 5,
  afternoon: 12,
  evening: 18,
} as const;

/** Below this width (px) the chart labels every other meeting's date, the newest included. */
export const CHART_THIN_LABELS_BELOW_PX = 400;

/** A touch screen: the primary pointer is coarse (a finger). */
export const COARSE_POINTER_MEDIA = "(pointer: coarse)";
