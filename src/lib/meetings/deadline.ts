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

const sameInstant = (a: string, b: string) =>
  new Date(a).getTime() === new Date(b).getTime();

/**
 * The deadline rule while editing a sent meeting (Review Focus 3): a deadline that already passed
 * may stay as it is, but the start may never move to before it; a changed deadline follows the full
 * rule. With nothing saved it is exactly `responseDeadlineProblem`. DB twin: the deadline block in
 * `private.edit_sent_meeting`.
 */
export function editDeadlineProblem(
  deadline: string,
  startsAt: string | null,
  now: Date,
  saved: string | null,
): ResponseDeadlineProblem | null {
  if (saved !== null && sameInstant(deadline, saved)) {
    return startsAt !== null &&
      new Date(deadline).getTime() >= new Date(startsAt).getTime()
      ? "afterStart"
      : null;
  }
  return responseDeadlineProblem(deadline, startsAt, now);
}
