import type { FillTone } from "@/design/tokens";
import { formatDeadline } from "@/lib/meetings/format";
import { ACTUAL_TONE, ANSWER_TONE } from "@/lib/responses/tones";
import type { MyInvite, MyInvitesTab } from "@/shared/api/my-invites";

/** A pill's message key under `MyInvites.pill`. */
export type InvitePillKey =
  | "notAnswered"
  | "answerBy"
  | "timeChanged"
  | "answer"
  | "cancelled"
  | "noAnswerNeeded"
  | "said"
  | "noAnswer"
  | "was";

/** One status pill of an invite card: what it says and its tone. */
export type InvitePill = {
  key: InvitePillKey;
  tone: FillTone;
  values?: Record<string, string | number>;
};

/**
 * The pills of an invite card (spec §7.4, mockups 2026-10-14). Upcoming: what to do next or the
 * answer. Past: what they said next to any check-in. Cancelled and announcements say only that.
 */
export function describeInvite(
  invite: MyInvite,
  tab: MyInvitesTab,
): InvitePill[] {
  if (invite.status === "cancelled") {
    return [{ key: "cancelled", tone: "neutral" }];
  }
  if (invite.responseMode === "announcement") {
    return [{ key: "noAnswerNeeded", tone: "neutral" }];
  }
  const { answer, mark } = invite;
  if (tab === "past") {
    const said: InvitePill = answer
      ? {
          key: "said",
          tone: ANSWER_TONE[answer.status],
          values: { status: answer.status, minutes: answer.delayMinutes ?? 0 },
        }
      : { key: "noAnswer", tone: "neutral" };
    return mark
      ? [
          said,
          {
            key: "was",
            tone: ACTUAL_TONE[mark.actual],
            values: { actual: mark.actual, minutes: mark.lateMinutes ?? 0 },
          },
        ]
      : [said];
  }
  if (answer?.needsReconfirmation) {
    return [
      {
        key: "timeChanged",
        tone: "warning",
        values: { answer: answer.status },
      },
    ];
  }
  if (answer) {
    return [
      {
        key: "answer",
        tone: ANSWER_TONE[answer.status],
        values: { status: answer.status, minutes: answer.delayMinutes ?? 0 },
      },
    ];
  }
  const pills: InvitePill[] = [{ key: "notAnswered", tone: "warning" }];
  if (invite.responseDeadline) {
    pills.push({
      key: "answerBy",
      tone: "neutral",
      values: {
        when: formatDeadline(invite.responseDeadline, invite.timezone),
      },
    });
  }
  return pills;
}
