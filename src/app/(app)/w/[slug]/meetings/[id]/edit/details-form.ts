import { DURATION_MAX, DURATION_MIN } from "@/config/meetings";
import { fittingDelays } from "@/lib/meetings/late";
import { zonedWallTimeToUtc } from "@/lib/meetings/format";
import type { LocationMode } from "@/shared/api/meeting-settings";
import {
  meetingUrlSchema,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";

/** The Details step's form state (date and time are wall values in `timezone`). */
export type DetailsValues = {
  title: string;
  date: string | null;
  time: string | null;
  timezone: string;
  durationMinutes: number;
  locationMode: LocationMode;
  locationText: string;
  onlineText: string;
  meetingUrl: string;
  agendaMd: string;
};

/** A message key under `Wizard.errors` for the Details step. */
export type DetailsErrorKey =
  | "titleRequired"
  | "dateRequired"
  | "timeRequired"
  | "inPast"
  | "placeRequired"
  | "onlineRequired"
  | "linkInvalid"
  | "durationRange"
  | "lateLongerThanMeeting";

/** Error keys under `Wizard.errors`, by field. */
export type DetailsErrors = Partial<
  Record<
    | "title"
    | "date"
    | "time"
    | "durationMinutes"
    | "locationText"
    | "onlineText"
    | "meetingUrl",
    DetailsErrorKey
  >
>;

const lengthInRange = (minutes: number) =>
  minutes >= DURATION_MIN && minutes <= DURATION_MAX;

/**
 * The late choices `values`' length would remove (#400): none while the length itself is out of
 * range, since that is refused first.
 */
export function delaysRemoved(
  values: DetailsValues,
  delayOptions: readonly number[],
): number[] {
  if (!lengthInRange(values.durationMinutes)) {
    return [];
  }
  const kept = fittingDelays(delayOptions, values.durationMinutes);
  return delayOptions.filter((minutes) => !kept.includes(minutes));
}

/**
 * What blocks "Next" on the Details step (the database re-checks at Send). `lockedDelays`: a sent
 * meeting's late choices, which can't change, so its length may only shrink while they fit (#400).
 */
export function validateDetails(
  values: DetailsValues,
  now: Date,
  lockedDelays: readonly number[] = [],
): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!values.title.trim()) {
    errors.title = "titleRequired";
  }
  if (!values.date) {
    errors.date = "dateRequired";
  }
  if (!values.time) {
    errors.time = "timeRequired";
  }
  if (values.date && values.time) {
    const start = zonedWallTimeToUtc({
      date: values.date,
      time: values.time,
      timezone: values.timezone,
    });
    if (new Date(start) <= now) {
      errors.time = "inPast";
    }
  }
  if (!lengthInRange(values.durationMinutes)) {
    errors.durationMinutes = "durationRange";
  } else if (delaysRemoved(values, lockedDelays).length > 0) {
    errors.durationMinutes = "lateLongerThanMeeting";
  }
  if (values.locationMode !== "online" && !values.locationText.trim()) {
    errors.locationText = "placeRequired";
  }
  if (values.locationMode !== "in_person") {
    // Where online in words (e.g. the club's Discord) and/or a link: at least one.
    if (!values.onlineText.trim() && !values.meetingUrl.trim()) {
      errors.onlineText = "onlineRequired";
    } else if (!meetingUrlSchema.safeParse(values.meetingUrl.trim()).success) {
      errors.meetingUrl = "linkInvalid";
    }
  }
  return errors;
}

/**
 * The PATCH body for a draft's Details step. A shorter length saves the late choices that still fit
 * in the same write (#400), so the draft never breaks the rule, not even between two saves.
 */
export function detailsPatch(
  values: DetailsValues,
  delayOptions: readonly number[],
): UpdateMeetingBody {
  const removed = delaysRemoved(values, delayOptions).length > 0;
  return {
    ...(removed
      ? { delayOptions: fittingDelays(delayOptions, values.durationMinutes) }
      : {}),
    title: values.title.trim(),
    startsAt:
      values.date && values.time
        ? zonedWallTimeToUtc({
            date: values.date,
            time: values.time,
            timezone: values.timezone,
          })
        : null,
    timezone: values.timezone,
    durationMinutes: values.durationMinutes,
    locationMode: values.locationMode,
    locationText: values.locationText.trim(),
    onlineText: values.onlineText.trim(),
    meetingUrl: values.meetingUrl.trim(),
    agendaMd: values.agendaMd,
  };
}
