import { DURATION_MAX, DURATION_MIN } from "@/config/meetings";
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
  | "linkRequired"
  | "linkInvalid"
  | "durationRange";

/** Error keys under `Wizard.errors`, by field. */
export type DetailsErrors = Partial<
  Record<
    | "title"
    | "date"
    | "time"
    | "durationMinutes"
    | "locationText"
    | "meetingUrl",
    DetailsErrorKey
  >
>;

/** What blocks "Next" on the Details step (the database re-checks at Send). */
export function validateDetails(
  values: DetailsValues,
  now: Date,
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
  if (
    values.durationMinutes < DURATION_MIN ||
    values.durationMinutes > DURATION_MAX
  ) {
    errors.durationMinutes = "durationRange";
  }
  if (values.locationMode !== "online" && !values.locationText.trim()) {
    errors.locationText = "placeRequired";
  }
  if (values.locationMode !== "in_person") {
    if (!values.meetingUrl.trim()) {
      errors.meetingUrl = "linkRequired";
    } else if (!meetingUrlSchema.safeParse(values.meetingUrl.trim()).success) {
      errors.meetingUrl = "linkInvalid";
    }
  }
  return errors;
}

/** The PATCH body for the Details step. */
export function detailsPatch(values: DetailsValues): UpdateMeetingBody {
  return {
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
    meetingUrl: values.meetingUrl.trim(),
    agendaMd: values.agendaMd,
  };
}
