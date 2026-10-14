/** Keys of what TapNShow keeps on a device (`localStorage`); all start with `tn.` (spec §11 Push privacy: wiped at sign-out). */
export const DEVICE_KEYS = {
  /** The last Upcoming chip on `/invites` (spec §7.4). */
  invitesFilter: "tn.invites.filter",
  /** Whose data this device holds (user id): another person's sign-in wipes it first. */
  owner: "tn.device.owner",
  /** Until when "Not now" hides the reminders card (ISO instant). */
  remindersHiddenUntil: "tn.reminders.hiddenUntil",
} as const;

/** A device storage key. */
export type DeviceKey = (typeof DEVICE_KEYS)[keyof typeof DEVICE_KEYS];

/** "Not now" on the reminders card hides it this long on that device (spec §7.4). */
export const REMINDERS_NOT_NOW_DAYS = 30;
