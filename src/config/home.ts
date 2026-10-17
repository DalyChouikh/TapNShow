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
