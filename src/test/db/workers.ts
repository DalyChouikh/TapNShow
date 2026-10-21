import { PARK_ALL_JOBS_SQL } from "./outbox";
import { PARK_ALL_PLATFORM_EVENTS_SQL } from "./platform";
import { PARK_ALL_CLEANUPS_SQL, PARK_ALL_SHARES_SQL } from "./sheet-shares";
import { PARK_ALL_SHEETS_SQL } from "./sheets";
import { runLocalScript } from "./sql";

/**
 * Parks every kind of work `private.workers_due` looks at (jobs, push deliveries, sheet redraws,
 * platform events, the team's shares and their cleanups), so a test can assert "nothing is due".
 * One place, and one database call: a new lane adds its park SQL here, not to each test.
 */
export function parkAllWork(): void {
  runLocalScript(
    [
      PARK_ALL_JOBS_SQL,
      PARK_ALL_SHEETS_SQL,
      PARK_ALL_PLATFORM_EVENTS_SQL,
      PARK_ALL_SHARES_SQL,
      PARK_ALL_CLEANUPS_SQL,
    ].join("\n"),
  );
}
