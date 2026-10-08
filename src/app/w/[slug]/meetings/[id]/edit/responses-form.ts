import { zonedWallTimeToUtc } from "@/lib/meetings/format";
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

/** Error keys under `Wizard.errors`. */
export type ResponsesErrors = {
  delayOptions?: "delaysRequired";
  deadline?: "deadlineOrder";
};

const deadlineOf = (values: ResponsesValues) =>
  values.deadlineEnabled && values.deadlineDate && values.deadlineTime
    ? zonedWallTimeToUtc({
        date: values.deadlineDate,
        time: values.deadlineTime,
        timezone: values.timezone,
      })
    : null;

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
    const deadline = deadlineOf(values);
    if (
      !deadline ||
      new Date(deadline) <= now ||
      (startsAt !== null && new Date(deadline) >= new Date(startsAt))
    ) {
      errors.deadline = "deadlineOrder";
    }
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
