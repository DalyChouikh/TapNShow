import { z } from "zod";

/** Why a Google Sheet paused (spec §7.17). Twin: `public.sheet_pause_reason`. */
export const sheetPauseReasonSchema = z.enum([
  "trashed",
  "deleted",
  "access_lost",
  "full",
  "drive_full",
]);
/** Why a Google Sheet paused. */
export type SheetPauseReason = z.infer<typeof sheetPauseReasonSchema>;

/**
 * Pauses that Try again resumes once the Owner fixed the cause (restored the file, freed space).
 * Twin: the paused_reason check in `private.retry_sheet`.
 */
export const SHEET_RETRYABLE_REASONS: ReadonlySet<SheetPauseReason> = new Set([
  "trashed",
  "drive_full",
]);

/** One TapNShow tab, for links that open a meeting's year (`sheet_tabs`). */
export const sheetTabSchema = z.object({
  year: z.number().int(),
  googleSheetId: z.number().int(),
  startsFrom: z.string().nullable(),
  startsTo: z.string().nullable(),
});

/** `GET /api/workspaces/[slug]/sheet`: what Settings > Sheets and the Export menus show. */
export const sheetStatusSchema = z.object({
  state: z.enum(["off", "creating", "on", "paused"]),
  spreadsheetId: z.string().nullable(),
  pausedReason: sheetPauseReasonSchema.nullable(),
  syncedAt: z.string().nullable(),
  /** Changes are waiting to be copied ("Updating…"). */
  behind: z.boolean(),
  createdAt: z.string().nullable(),
  turnedOnBy: z.string(),
  /** The Google account whose Drive holds the file; the Owner only. */
  accountEmail: z.string().nullable(),
  ownerName: z.string(),
  /** Newest year first. */
  tabs: z.array(sheetTabSchema),
});
/** A workspace's Google Sheet as one member sees it. */
export type SheetStatus = z.infer<typeof sheetStatusSchema>;
