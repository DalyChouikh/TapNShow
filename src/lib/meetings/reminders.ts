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
 * The instant a reminder counts back from: the not-answered one from the deadline (else the start),
 * Going and Late from the start; null when the meeting asks for no answers or has no start yet.
 */
export function reminderBase(
  meeting: Omit<ReminderTiming, "reminderPendingHours" | "reminderGoingHours">,
  audience: ReminderAudience,
): string | null {
  if (meeting.responseMode === "announcement" || meeting.startsAt === null) {
    return null;
  }
  return audience === "pending"
    ? (meeting.responseDeadline ?? meeting.startsAt)
    : meeting.startsAt;
}

/** The instant `hours` before `base` (a reminder's due time). */
const hoursBefore = (base: string, hours: number) =>
  Date.parse(base) - hours * HOUR_MS;

/**
 * When a meeting's reminder goes out once it is sent: `reminderPendingHours` / `reminderGoingHours`
 * before its base (`reminderBase`); null when it is off or has no base. SQL twin (for a sent
 * meeting): `private.reminder_due`, pinned by `reminder-due.db.test.ts`.
 */
export function reminderDueAt(
  meeting: ReminderTiming,
  audience: ReminderAudience,
): Date | null {
  const base = reminderBase(meeting, audience);
  const hours =
    audience === "pending"
      ? meeting.reminderPendingHours
      : meeting.reminderGoingHours;
  return base === null || hours === null
    ? null
    : new Date(hoursBefore(base, hours));
}

/**
 * What a reminder row offers at `now` (#403, like the late-time chips): the `choices` whose time is
 * still ahead (a time due right now has passed, as `private.sync_reminder_timers` treats it), and
 * the hours to save: the picked ones while still ahead, else the longest left (`replaced` names the
 * picked hours), else none (`tooClose`). Every choice while there is no base yet.
 */
export function offerReminder({
  picked,
  choices,
  base,
  now,
}: {
  picked: number | null;
  choices: readonly number[];
  base: string | null;
  now: Date;
}): {
  choices: number[];
  value: number | null;
  replaced: number | null;
  tooClose: boolean;
} {
  const ahead =
    base === null
      ? [...choices]
      : choices.filter((hours) => hoursBefore(base, hours) > now.getTime());
  const tooClose = ahead.length === 0;
  if (picked === null || ahead.includes(picked)) {
    return { choices: ahead, value: picked, replaced: null, tooClose };
  }
  return {
    choices: ahead,
    value: tooClose ? null : Math.max(...ahead),
    replaced: picked,
    tooClose,
  };
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
