import { addMinutes, isAfter } from "date-fns";
import type { MeetingSummary } from "@/shared/api/meetings";

const startOf = (m: MeetingSummary) =>
  m.startsAt ? new Date(m.startsAt).getTime() : 0;

/** Meetings page tabs (spec §10): Drafts, Upcoming (soonest first, including one in progress), Past. */
export function partitionMeetings(meetings: MeetingSummary[], now: Date) {
  // An untitled, undated draft is a "+" tap that went nowhere; housekeeping deletes it after 24 h.
  const drafts = meetings.filter(
    (m) => m.status === "draft" && (m.title !== "" || m.startsAt !== null),
  );
  const upcoming = meetings
    .filter(
      (m) =>
        m.status === "scheduled" &&
        m.startsAt &&
        isAfter(addMinutes(new Date(m.startsAt), m.durationMinutes), now),
    )
    .sort((a, b) => startOf(a) - startOf(b));
  const past = meetings
    .filter((m) => m.status !== "draft" && !upcoming.includes(m))
    .sort((a, b) => startOf(b) - startOf(a));
  return { drafts, upcoming, past };
}
