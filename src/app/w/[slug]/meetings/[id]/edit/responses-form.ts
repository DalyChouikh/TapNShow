import { responseDeadlineProblem } from "@/lib/meetings/deadline";
import { utcToZonedParts, zonedWallTimeToUtc } from "@/lib/meetings/format";
import type { ResponseMode } from "@/shared/api/meeting-settings";
import type { UpdateMeetingBody } from "@/shared/api/meetings";

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
  const problem = responseDeadlineProblem(deadline, startsAt, now);
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

/** What blocks "Next" on the Responses step. */
export function validateResponses(
  values: ResponsesValues,
  startsAt: string | null,
  now: Date,
): ResponsesErrors {
  const errors: ResponsesErrors = {};
  if (
    values.responseMode === "attendance" &&
    values.delayOptions.length === 0
  ) {
    errors.delayOptions = "delaysRequired";
  }
  if (values.deadlineEnabled && values.responseMode !== "announcement") {
    Object.assign(errors, deadlineErrors(values, startsAt, now));
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
  };
}
