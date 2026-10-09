import { z } from "zod";
import type { MemberVisibleField } from "@/config/meeting-edit";
import type { ChangeSet, ChangeValue } from "@/shared/api/meeting-changes";
import { locationModeSchema } from "@/shared/api/meeting-settings";
import { formatDeadline, formatMeetingWhen } from "./format";

const cardMeetingSchema = z.object({
  title: z.string(),
  startsAt: z.string(),
  durationMinutes: z.number(),
  timezone: z.string(),
  locationMode: locationModeSchema,
  locationText: z.string(),
  onlineText: z.string(),
  meetingUrl: z.string(),
  agendaMd: z.string(),
  responseDeadline: z.string().nullable(),
  footerNote: z.string(),
});

/** The meeting fields the marked card shows (a `Meeting` or the email's meeting both fit). */
export type CardMeeting = z.infer<typeof cardMeetingSchema>;

/** One part of the card, in display order. */
export type SectionKey =
  "title" | "when" | "where" | "link" | "deadline" | "agenda" | "note";

/**
 * A card part as shown (owner's mockup, 2026-10-09): `before` is set when the part changed (shown
 * struck through above `now`); long text only says `updated`. Shared by the update email and the
 * Review changes step.
 */
export type CardSection = {
  key: SectionKey;
  now: string;
  before: string | null;
  updated: boolean;
};

/** Words the card needs (the caller translates). */
export type CardText = { none: string; joinLink: (url: string) => string };

/** Column → card field (only member-visible columns; DB twin: `c_visible`). */
const FIELD_OF = {
  title: "title",
  starts_at: "startsAt",
  duration_minutes: "durationMinutes",
  timezone: "timezone",
  location_mode: "locationMode",
  location_text: "locationText",
  online_text: "onlineText",
  meeting_url: "meetingUrl",
  agenda_md: "agendaMd",
  response_deadline: "responseDeadline",
  footer_note: "footerNote",
} as const satisfies Record<MemberVisibleField, keyof CardMeeting>;

/** The meeting as it was before `changes` (each changed field set back to its old value). */
export function meetingBefore(
  meeting: CardMeeting,
  changes: ChangeSet,
): CardMeeting {
  const before: Record<string, ChangeValue> = { ...meeting };
  for (const [column, field] of Object.entries(FIELD_OF)) {
    const change = changes[column];
    if (change) {
      before[field] = change[0];
    }
  }
  return cardMeetingSchema.parse(before);
}

/** True when anything members can see changed (else the email is only a calendar note). */
export function hasMemberChanges(changes: ChangeSet): boolean {
  return Object.keys(FIELD_OF).some((column) => column in changes);
}

function whenText(meeting: CardMeeting): string {
  const when = formatMeetingWhen(meeting);
  return `${when.date}, ${when.start}–${when.end} (${when.zone})`;
}

function whereText(meeting: CardMeeting): string {
  return [
    meeting.locationMode !== "online" ? meeting.locationText : "",
    meeting.locationMode !== "in_person" ? meeting.onlineText : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The card's parts in order: title, when and where always; then the join link and the deadline
 * when relevant, and agenda/note as "Updated" when they changed.
 */
export function markedCard(
  meeting: CardMeeting,
  changes: ChangeSet,
  text: CardText,
): CardSection[] {
  const old = meetingBefore(meeting, changes);
  const part = (key: SectionKey, now: string, was: string): CardSection => ({
    key,
    now,
    before: now === was ? null : was,
    updated: false,
  });
  const link = (m: CardMeeting) =>
    m.meetingUrl ? text.joinLink(m.meetingUrl) : text.none;
  const deadline = (m: CardMeeting) =>
    m.responseDeadline
      ? formatDeadline(m.responseDeadline, m.timezone)
      : text.none;
  const sections: CardSection[] = [
    part("title", meeting.title, old.title),
    part("when", whenText(meeting), whenText(old)),
    part("where", whereText(meeting) || text.none, whereText(old) || text.none),
  ];
  if (meeting.meetingUrl !== old.meetingUrl) {
    sections.push(part("link", link(meeting), link(old)));
  }
  if (meeting.responseDeadline || old.responseDeadline) {
    sections.push(part("deadline", deadline(meeting), deadline(old)));
  }
  if (meeting.agendaMd !== old.agendaMd) {
    sections.push({ key: "agenda", now: "", before: null, updated: true });
  }
  if (meeting.footerNote !== old.footerNote) {
    sections.push({ key: "note", now: "", before: null, updated: true });
  }
  return sections;
}
