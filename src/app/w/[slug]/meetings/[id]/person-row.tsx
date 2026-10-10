"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAnswerLabels } from "@/hooks/use-answer-labels";
import { describeAnswer } from "@/lib/responses/describe-answer";
import { cn } from "@/lib/utils";
import type { AnswerStatus, PersonRow } from "@/shared/api/responses";

const PILL: Record<AnswerStatus, string> = {
  attending: "bg-fill-success",
  late: "bg-fill-warning",
  absent: "bg-fill-danger",
  not_attending: "bg-fill-danger",
};

/** "Fri 9 Oct, 14:05" in the meeting's zone. */
export function answeredAt(iso: string, timezone: string): string {
  return format(new TZDate(iso, timezone), "EEE d MMM, HH:mm");
}

/** The person's name: a link to their sheet (roster people), plain text for one-off guests. */
export function PersonName({
  slug,
  person,
}: {
  slug: string;
  person: PersonRow;
}) {
  return person.isAdhoc ? (
    <span className="font-bold break-words">{person.fullName}</span>
  ) : (
    <Link
      href={`/w/${slug}/lists?person=${person.contactId}`}
      className="font-bold break-words underline-offset-4 hover:underline"
    >
      {person.fullName}
    </Link>
  );
}

/** The answer pill ("Late by 20 min"), "No answer yet" or "Email not delivered". */
export function AnswerPill({ person }: { person: PersonRow }) {
  const t = useTranslations("MeetingPage.results");
  const labels = useAnswerLabels();
  if (person.answer) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "inline-block rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
            PILL[person.answer.status],
          )}
        >
          {describeAnswer(labels, person.answer)}
        </span>
        {person.answer.needsReconfirmation ? (
          <span className="text-xs font-bold">{t("toReconfirmPill")}</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="text-sm text-muted-ink">
      {person.emailStatus === "failed" || person.emailStatus === "skipped"
        ? t("notDelivered")
        : t("notAnswered")}
    </span>
  );
}

/** One person on a phone: name, answer, reason and comment as plain text, when they answered. */
export function PersonCard({
  slug,
  person,
  timezone,
}: {
  slug: string;
  person: PersonRow;
  timezone: string;
}) {
  const t = useTranslations("MeetingPage.results");
  return (
    <li className="flex flex-col gap-1 border-b border-dashed border-outline/30 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <PersonName slug={slug} person={person} />
        <AnswerPill person={person} />
        {person.answer?.afterDeadline ? (
          <span className="text-xs text-muted-ink">{t("afterDeadline")}</span>
        ) : null}
      </div>
      {person.answer?.reason ? (
        <p className="text-sm break-words whitespace-pre-line">
          {person.answer.reason}
        </p>
      ) : null}
      {person.answer?.comment ? (
        <p className="text-sm break-words whitespace-pre-line text-muted-ink">
          {person.answer.comment}
        </p>
      ) : null}
      {person.answer ? (
        <p className="text-xs text-muted-ink">
          {t("answeredAt", {
            time: answeredAt(person.answer.updatedAt, timezone),
          })}
        </p>
      ) : null}
    </li>
  );
}
