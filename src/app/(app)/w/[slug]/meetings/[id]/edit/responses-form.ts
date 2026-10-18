import {
  REMINDER_GOING_CHOICES,
  REMINDER_PENDING_CHOICES,
  type ReminderAudience,
} from "@/config/reminders";
import { editDeadlineProblem } from "@/lib/meetings/deadline";
import { utcToZonedParts, zonedWallTimeToUtc } from "@/lib/meetings/format";
import {
  offerReminder,
  reminderBase,
  reminderDueAt,
} from "@/lib/meetings/reminders";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import type { Meeting, UpdateMeetingBody } from "@/shared/api/meetings";

/** The Responses step's form state. */
export type ResponsesValues = {
  responseMode: ResponseMode;
  delayOptions: number[];
  reasonRequired: boolean;
  commentsEnabled: boolean;
  footerNote: string;
  deadlineEnabled: boolean;
  deadlineDate: string | null;
  deadlineTime: string | null;
  timezone: string;
  reminderPendingHours: number | null;
  reminderGoingHours: number | null;
};

/** Error keys under `Wizard.errors`, each shown on the field that is wrong. */
export type ResponsesErrors = {
  delayOptions?: "delaysRequired";
  deadlineDate?: "dateRequired" | "deadlineAfterStart";
  deadlineTime?: "timeRequired" | "inPast" | "deadlineAfterStart";
};

const deadlineOf = (values: ResponsesValues) =>
  values.deadlineEnabled && values.deadlineDate && values.deadlineTime
    ? zonedWallTimeToUtc({
        date: values.deadlineDate,
        time: values.deadlineTime,
        timezone: values.timezone,
      })
    : null;

/**
 * Deadline errors on the field to change: a day after the meeting day is the date's fault; on the
 * meeting day (or earlier) a refused deadline is the time's.
 */
function deadlineErrors(
  values: ResponsesValues,
  startsAt: string | null,
  now: Date,
  savedDeadline: string | null,
): ResponsesErrors {
  const { deadlineDate, deadlineTime, timezone } = values;
  if (!deadlineDate || !deadlineTime) {
    return {
      ...(deadlineDate ? {} : { deadlineDate: "dateRequired" }),
      ...(deadlineTime ? {} : { deadlineTime: "timeRequired" }),
    };
  }
  const deadline = zonedWallTimeToUtc({
    date: deadlineDate,
    time: deadlineTime,
    timezone,
  });
  const problem = editDeadlineProblem(deadline, startsAt, now, savedDeadline);
  if (problem === "inPast") {
    return { deadlineTime: "inPast" };
  }
  if (problem === "afterStart") {
    const afterMeetingDay =
      startsAt !== null &&
      deadlineDate > utcToZonedParts(startsAt, timezone).date;
    return afterMeetingDay
      ? { deadlineDate: "deadlineAfterStart" }
      : { deadlineTime: "deadlineAfterStart" };
  }
  return {};
}

/**
 * What blocks "Next" on the Responses step. `savedDeadline`: the sent meeting's deadline while
 * editing (one that already passed may stay); null for drafts (the plain rule).
 */
export function validateResponses(
  values: ResponsesValues,
  startsAt: string | null,
  now: Date,
  savedDeadline: string | null = null,
): ResponsesErrors {
  const errors: ResponsesErrors = {};
  if (
    values.responseMode === "attendance" &&
    values.delayOptions.length === 0
  ) {
    errors.delayOptions = "delaysRequired";
  }
  if (values.deadlineEnabled && values.responseMode !== "announcement") {
    Object.assign(errors, deadlineErrors(values, startsAt, now, savedDeadline));
  }
  return errors;
}

/** The PATCH body for the Responses step. */
export function responsesPatch(values: ResponsesValues): UpdateMeetingBody {
  const answers = values.responseMode !== "announcement";
  return {
    responseMode: values.responseMode,
    delayOptions:
      values.responseMode === "attendance" ? values.delayOptions : [],
    reasonRequired: answers && values.reasonRequired,
    commentsEnabled: answers && values.commentsEnabled,
    footerNote: answers ? values.footerNote.trim() : "",
    responseDeadline: answers ? deadlineOf(values) : null,
    reminderPendingHours: answers ? values.reminderPendingHours : null,
    reminderGoingHours: answers ? values.reminderGoingHours : null,
  };
}

/** One reminder row on the Answers step (#403): what it offers and what it saves. */
export type ReminderRow = {
  /** The hours offered: those still ahead, or only the saved hours when locked. */
  choices: number[];
  /** The hours shown selected and saved; null is off. */
  value: number | null;
  /** The picked hours, passed and replaced by `value` (or by off when too close). */
  replaced: number | null;
  /** No time is left before the start or deadline: off and greyed. */
  tooClose: boolean;
  /** A sent meeting's reminder whose time passed without its start or deadline moving. */
  locked: boolean;
  /** It counts back from the deadline rather than the start (for the wording). */
  fromDeadline: boolean;
};

const REMINDER_CHOICES: Record<ReminderAudience, readonly number[]> = {
  pending: REMINDER_PENDING_CHOICES,
  going: REMINDER_GOING_CHOICES,
};

/**
 * The two reminder rows at `now`, from the step's current values (#403). A time already passed is
 * never offered, and a passed pick becomes the longest time left. `saved`: the sent meeting while
 * editing (null for drafts): its reminder whose time passed, with the start or deadline unmoved,
 * stays as it is and locked, because changing it can't send it again
 * (`private.sync_reminder_timers` keeps a reminder that went out).
 */
export function reminderRows(
  values: ResponsesValues,
  startsAt: string | null,
  now: Date,
  saved: Pick<
    Meeting,
    | "startsAt"
    | "responseDeadline"
    | "responseMode"
    | "reminderPendingHours"
    | "reminderGoingHours"
  > | null,
): Record<ReminderAudience, ReminderRow> {
  const current = {
    startsAt,
    responseDeadline: deadlineOf(values),
    responseMode: values.responseMode,
  };
  const picked: Record<ReminderAudience, number | null> = {
    pending: values.reminderPendingHours,
    going: values.reminderGoingHours,
  };
  const row = (audience: ReminderAudience): ReminderRow => {
    const base = reminderBase(current, audience);
    const fromDeadline =
      audience === "pending" && current.responseDeadline !== null;
    const savedDue = saved ? reminderDueAt(saved, audience) : null;
    const savedHours = saved
      ? audience === "pending"
        ? saved.reminderPendingHours
        : saved.reminderGoingHours
      : null;
    if (
      saved &&
      savedHours !== null &&
      savedDue !== null &&
      savedDue.getTime() <= now.getTime() &&
      reminderBase(saved, audience) === base
    ) {
      return {
        choices: [savedHours],
        value: savedHours,
        replaced: null,
        tooClose: false,
        locked: true,
        fromDeadline,
      };
    }
    const offer = offerReminder({
      picked: picked[audience],
      choices: REMINDER_CHOICES[audience],
      base,
      now,
    });
    return { ...offer, locked: false, fromDeadline };
  };
  return { pending: row("pending"), going: row("going") };
}
