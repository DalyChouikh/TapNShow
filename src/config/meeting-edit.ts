/**
 * Fields an organizer can change after sending (spec §4 Edits after sending). The answer type and
 * the Late delays are fixed once sent. DB twin: `c_editable` in `private.edit_sent_meeting`.
 */
export const EDITABLE_FIELDS = [
  "title",
  "agenda_md",
  "starts_at",
  "duration_minutes",
  "timezone",
  "location_mode",
  "location_text",
  "online_text",
  "meeting_url",
  "response_deadline",
  "reason_required",
  "comments_enabled",
  "footer_note",
  "reminder_pending_hours",
  "reminder_going_hours",
] as const;

/** What members see, in the order a change summary lists them. DB twin: `c_visible`. */
export const MEMBER_VISIBLE_FIELDS = [
  "title",
  "starts_at",
  "duration_minutes",
  "timezone",
  "location_mode",
  "location_text",
  "online_text",
  "meeting_url",
  "agenda_md",
  "response_deadline",
  "footer_note",
] as const;

/** A change here emails everyone and (starts_at) asks them to reconfirm. DB twin: `c_schedule`. */
export const SCHEDULE_FIELDS = ["starts_at", "duration_minutes"] as const;

/** A change here emails everyone but people who said they can't come. DB twin: `c_place`. */
export const PLACE_FIELDS = [
  "location_mode",
  "location_text",
  "online_text",
  "meeting_url",
] as const;

/** What the calendar event shows; a change updates the event in calendars. DB twin: `c_calendar`. */
export const CALENDAR_FIELDS = [
  "title",
  "agenda_md",
  "starts_at",
  "duration_minutes",
  "location_mode",
  "location_text",
  "online_text",
  "meeting_url",
] as const;

/** One editable column. */
export type EditableField = (typeof EDITABLE_FIELDS)[number];
/** One member-visible column. */
export type MemberVisibleField = (typeof MEMBER_VISIBLE_FIELDS)[number];
