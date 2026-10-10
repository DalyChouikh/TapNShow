import type { Answer } from "@/shared/api/responses";

/** Wording of each answer (from `AnswerPage.answer.*`). */
export type AnswerLabels = {
  attending: string;
  late: (minutes: number) => string;
  absent: string;
  not_attending: string;
};

/** "Going", "Late by 20 min", "Can't come", "Not going". */
export function describeAnswer(
  labels: AnswerLabels,
  answer: Pick<Answer, "status" | "delayMinutes">,
): string {
  return answer.status === "late"
    ? labels.late(answer.delayMinutes ?? 0)
    : labels[answer.status];
}

/** "Going" → "going", to use an answer inside a sentence ("Yes, still going"). */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
