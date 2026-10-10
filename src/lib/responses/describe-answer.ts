import type { Answer, Mark } from "@/shared/api/responses";
import { declaredActual } from "./check-in";

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

/** The words `describeCheckIn` needs (the caller translates). */
export type CheckInWords = {
  noReply: string;
  didntAnswer: string;
  /** "Said going". */
  said: (answer: string) => string;
  /** "present", "late", "absent" (inside a sentence). */
  actual: (value: Mark["actual"]) => string;
  /** "late by 15 min" (inside a sentence), for a Late check-in with minutes. */
  lateBy: (minutes: number) => string;
  /** "Said going · Was absent". */
  saidWas: (said: string, was: string) => string;
};

/**
 * What someone said next to what happened (spec §7.7): the plain answer without a check-in;
 * with one, always both (owner feedback #257): "Going · Was present" when they agree, "Said going
 * · Was absent" or "Didn't answer · Was late by 15 min" when they differ.
 */
export function describeCheckIn(
  labels: AnswerLabels,
  words: CheckInWords,
  answer: Pick<Answer, "status" | "delayMinutes"> | null,
  mark: Mark | null,
): string {
  const plain = answer ? describeAnswer(labels, answer) : words.noReply;
  if (!mark) {
    return plain;
  }
  const was =
    mark.actual === "late" && mark.lateMinutes !== null
      ? words.lateBy(mark.lateMinutes)
      : words.actual(mark.actual);
  if (mark.actual === declaredActual(answer?.status ?? null)) {
    return words.saidWas(plain, was);
  }
  const said = answer
    ? words.said(lowerFirst(describeAnswer(labels, answer)))
    : words.didntAnswer;
  return words.saidWas(said, was);
}
