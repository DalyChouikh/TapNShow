import { type APIRequestContext, expect } from "@playwright/test";
import { adminClient } from "./admin";
import { runWorkers } from "./meetings";

/**
 * Makes a workspace's changed years due now, as if the 1-minute quiet time had passed. Twin:
 * `makeDue` in src/test/db/sheets.ts.
 */
export async function makeSheetDue(workspaceId: string): Promise<void> {
  const past = new Date(Date.now() - 120_000).toISOString();
  const { error } = await adminClient()
    .from("sheet_dirty_years")
    .update({ changed_at: past, first_changed_at: past })
    .eq("workspace_id", workspaceId);
  if (error) {
    throw error;
  }
}

/** The workspace's sheet status (`active` or `paused`), or null without a sheet. */
export async function sheetStatus(
  workspaceId: string,
): Promise<"active" | "paused" | null> {
  const { data, error } = await adminClient()
    .from("sheet_syncs")
    .select("status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data?.status ?? null;
}

/** Moves a meeting's start to `startsAt` (e.g. into the past, so the door check-in opens). */
export async function moveMeetingStart(
  meetingId: string,
  startsAt: Date,
): Promise<void> {
  const { error } = await adminClient()
    .from("meetings")
    .update({ starts_at: startsAt.toISOString() })
    .eq("id", meetingId);
  if (error) {
    throw error;
  }
}

/**
 * Runs the workers as cron would, with the 1-minute quiet time skipped, until `check` holds (the
 * workers finish after the route answers, so each check sees the run before).
 */
export async function syncSheetUntil(
  request: APIRequestContext,
  workspaceId: string,
  check: () => Promise<boolean>,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await makeSheetDue(workspaceId);
        await runWorkers(request);
        return check();
      },
      { timeout: 30_000, intervals: [1_500] },
    )
    .toBe(true);
}
