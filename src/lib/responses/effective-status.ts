import type { AnswerStatus, Mark } from "@/shared/api/responses";

const FROM_MARK = {
  present: "attending",
  late: "late",
  absent: "absent",
} as const;

/** What counts for one person and meeting (spec §7.7): the check-in, else the answer. DB twin: `private.effective_status`. */
export function effectiveStatus(
  mark: Mark | null,
  answer: { status: AnswerStatus } | null,
): "attending" | "late" | "absent" | null {
  if (mark) {
    return FROM_MARK[mark.actual];
  }
  if (!answer) {
    return null;
  }
  return answer.status === "not_attending" ? "absent" : answer.status;
}
