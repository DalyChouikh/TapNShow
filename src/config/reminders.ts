/** "People who haven't answered" reminder choices in hours (DB twin: the `reminder_pending_hours` checks). */
export const REMINDER_PENDING_CHOICES = [1, 2, 6, 24, 48] as const;
/** "Going and Late" reminder choices in hours (DB twin: the `reminder_going_hours` checks). */
export const REMINDER_GOING_CHOICES = [1, 2, 6, 24] as const;
/** Default for new workspaces (DB twin: `workspaces.default_reminder_pending_hours` default). */
export const REMINDER_PENDING_DEFAULT = 24;
/** Default for new workspaces (DB twin: `workspaces.default_reminder_going_hours` default). */
export const REMINDER_GOING_DEFAULT = 2;
/** One "not answered" choice. */
export type ReminderPendingHours = (typeof REMINDER_PENDING_CHOICES)[number];
/** One "Going and Late" choice. */
export type ReminderGoingHours = (typeof REMINDER_GOING_CHOICES)[number];
