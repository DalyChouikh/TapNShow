import { parkAllJobs } from "./outbox";
import { parkAllPlatformEvents } from "./platform";
import { parkAllCleanups, parkAllShares } from "./sheet-shares";
import { parkAllSheets } from "./sheets";

/**
 * Parks every kind of work `private.workers_due` looks at (jobs, push deliveries, sheet redraws,
 * platform events, the team's shares and their cleanups), so a test can assert "nothing is due".
 * One place: a new lane adds its park here, not to each test.
 */
export function parkAllWork(): void {
  parkAllJobs();
  parkAllSheets();
  parkAllPlatformEvents();
  parkAllShares();
  parkAllCleanups();
}
