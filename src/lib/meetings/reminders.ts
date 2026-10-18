import { REMINDER_AUDIENCES, type ReminderAudience } from "@/config/reminders";
import type { Meeting } from "@/shared/api/meetings";

type ReminderTiming = Pick<
  Meeting,
  | "startsAt"
  | "responseDeadline"
  | "responseMode"
  | "reminderPendingHours"
  | "reminderGoingHours"
>;

const HOUR_MS = 3_600_000;

/**
 * When a meeting's reminder goes out once it is sent: the not-answered one `reminderPendingHours`
 * before the deadline (else the start), Going and Late `reminderGoingHours` before the start; null
 * when it is off, the meeting asks for no answers, or has no start yet. SQL twin (for a sent
 * meeting): `private.reminder_due`, pinned by `reminder-due.db.test.ts`.
 */
export function reminderDueAt(
  meeting: ReminderTiming,
  audience: ReminderAudience,
): Date | null {
  if (meeting.responseMode === "announcement" || meeting.startsAt === null) {
    return null;
  }
  const hours =
    audience === "pending"
      ? meeting.reminderPendingHours
      : meeting.reminderGoingHours;
  if (hours === null) {
    return null;
  }
  const from =
    audience === "pending"
      ? (meeting.responseDeadline ?? meeting.startsAt)
      : meeting.startsAt;
  return new Date(Date.parse(from) - hours * HOUR_MS);
}

/**
 * The reminders that won't go out if the meeting is sent at `now`: due at or before it, the ones
 * `private.sync_reminder_timers` drops (#403).
 */
export function remindersSkippedAt(
  meeting: ReminderTiming,
  now: Date,
): ReminderAudience[] {
  return REMINDER_AUDIENCES.filter((audience) => {
    const due = reminderDueAt(meeting, audience);
    return due !== null && due.getTime() <= now.getTime();
  });
}
