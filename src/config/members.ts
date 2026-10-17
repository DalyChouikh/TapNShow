/** Keys of what TapNShow keeps on a device (`localStorage`); all start with `tn.` (spec §11 Push privacy: wiped at sign-out). */
export const DEVICE_KEYS = {
  /** The last Upcoming chip on `/invites` (spec §7.4). */
  invitesFilter: "tn.invites.filter",
  /** Whose data this device holds (user id): another person's sign-in wipes it first. */
  owner: "tn.device.owner",
  /** Until when "Not now" hides the reminders card (ISO instant). */
  remindersHiddenUntil: "tn.reminders.hiddenUntil",
  /** When this device last re-sent its reminders subscription (ISO instant). */
  remindersCheckedInAt: "tn.reminders.checkedInAt",
  /** Until when "Not now" hides Home's Google Sheets tip (ISO instant). */
  sheetsTipHiddenUntil: "tn.home.sheetsTipHiddenUntil",
} as const;

/** A device storage key. */
export type DeviceKey = (typeof DEVICE_KEYS)[keyof typeof DEVICE_KEYS];

/** "Not now" on the reminders card hides it this long on that device (spec §7.4). */
export const REMINDERS_NOT_NOW_DAYS = 30;

/**
 * A device with reminders on re-sends its subscription at most this often, so the server knows it
 * is alive. Must stay far below `push_subscription_idle_days` (`private.app_limits`, 90), after which
 * housekeeping forgets a device with no sign of life (spec §8).
 */
export const REMINDERS_CHECK_IN_HOURS = 24;
