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

/** Where one person's share stands (`sheet_shares.state`). Twin: `public.sheet_share_state`. */
export const SHEET_SHARE_STATES = [
  "pending",
  "sharing",
  "shared",
  "external",
  "refused",
] as const;
/** Where one person's share stands. */
export type SheetShareState = (typeof SHEET_SHARE_STATES)[number];

/** Why someone can't open the sheet (`sheet_shares.reason`). Twin: `public.sheet_share_reason`. */
export const SHEET_SHARE_REASONS = [
  "refused",
  "too_many",
  "removed_in_drive",
] as const;
/** Why someone can't open the sheet. */
export type SheetShareReason = (typeof SHEET_SHARE_REASONS)[number];

/** One TapNShow tab, for links that open a meeting's year (`sheet_tabs`). */
export const sheetTabSchema = z.object({
  year: z.number().int(),
  googleSheetId: z.number().int(),
  startsFrom: z.string().nullable(),
  startsTo: z.string().nullable(),
});

/** A team member's own access to the sheet (their line in Settings > Sheets, #413). */
export const SHEET_MY_ACCESS = [
  "shared",
  "sharing",
  "refused",
  "sheet_account",
] as const;

/**
 * Sharing the sheet with the team (#413, design §3), null while it's switched off. The counts
 * cover the people TapNShow shares with (the team minus the sheet's own Google account).
 */
export const sheetSharingSchema = z.object({
  /** Admins and Viewers: who the connect dialog says will get a link. */
  teamCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  canView: z.number().int().nonnegative(),
  cantOpen: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  /** The caller's own line; null for the Owner, or before there is a sheet. */
  mine: z.enum(SHEET_MY_ACCESS).nullable(),
  myEmail: z.string().nullable(),
});
/** Sharing the sheet with the team, as one member sees it. */
export type SheetSharing = z.infer<typeof sheetSharingSchema>;

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
  sharing: sheetSharingSchema.nullable(),
});
/** A workspace's Google Sheet as one member sees it. */
export type SheetStatus = z.infer<typeof sheetStatusSchema>;
