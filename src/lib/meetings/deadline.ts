/** Why an answer deadline is refused: it has passed, or it is not before the start. */
export type ResponseDeadlineProblem = "inPast" | "afterStart";

/**
 * The answer-deadline rule (spec §7.2): `now < deadline < start`, so a deadline later the same day
 * as the meeting is fine. `null` when the deadline is valid; only the past is checked while the
 * start is unknown. The database twin is in `private.send_meeting`.
 */
export function responseDeadlineProblem(
  deadline: string,
  startsAt: string | null,
  now: Date,
): ResponseDeadlineProblem | null {
  const at = new Date(deadline).getTime();
  if (at <= now.getTime()) {
    return "inPast";
  }
  if (startsAt !== null && at >= new Date(startsAt).getTime()) {
    return "afterStart";
  }
  return null;
}
