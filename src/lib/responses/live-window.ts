import { addMinutes } from "date-fns";
import { RESULTS_POLL_STOP_AFTER_END_MS } from "@/config/responses";

/** Whether the meeting page keeps refreshing answers (spec §7.7: stops a few hours after the end). */
export function isLive(
  meeting: { startsAt: string | null; durationMinutes: number },
  now: Date,
): boolean {
  if (!meeting.startsAt) {
    return false;
  }
  const end = addMinutes(new Date(meeting.startsAt), meeting.durationMinutes);
  return now.getTime() < end.getTime() + RESULTS_POLL_STOP_AFTER_END_MS;
}
