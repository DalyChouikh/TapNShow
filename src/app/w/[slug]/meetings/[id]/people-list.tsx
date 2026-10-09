"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { ROSTER_GRID_MEDIA } from "@/config/roster";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMeetingPeople } from "@/hooks/use-results";
import type { PeopleFilter } from "@/shared/api/responses";
import { AnswerPill, answeredAt, PersonCard, PersonName } from "./person-row";

/**
 * The people of the pressed tile (or everyone), paged with "Show more" (#174): cards on phones,
 * a table from `md` up. Reasons and comments are plain text, never HTML.
 */
export function PeopleList({
  slug,
  meetingId,
  filter,
  live,
  timezone,
}: {
  slug: string;
  meetingId: string;
  filter: PeopleFilter;
  live: boolean;
  timezone: string;
}) {
  const t = useTranslations("MeetingPage.results");
  const wide = useMediaQuery(ROSTER_GRID_MEDIA);
  const people = useMeetingPeople(slug, meetingId, filter, live);
  if (people.query.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  return (
    <Card as="section" className="flex flex-col gap-2">
      <h2 className="font-display text-lg">{t("peopleTitle")}</h2>
      {people.items.length === 0 ? (
        <p className="text-sm text-muted-ink">{t("emptyFilter")}</p>
      ) : wide ? (
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-[length:var(--tn-border-width)] border-outline">
              <th className="w-1/5 py-2 pr-2">{t("columns.name")}</th>
              <th className="w-1/6 py-2 pr-2">{t("columns.answer")}</th>
              <th className="py-2 pr-2">{t("columns.reason")}</th>
              <th className="w-1/5 py-2 pr-2">{t("columns.comment")}</th>
              <th className="w-[9rem] py-2">{t("columns.answered")}</th>
            </tr>
          </thead>
          <tbody>
            {people.items.map((person) => (
              <tr
                key={person.inviteeId}
                className="border-b border-dashed border-outline/30 align-top last:border-b-0"
              >
                <td className="py-2 pr-2">
                  <PersonName slug={slug} person={person} />
                </td>
                <td className="py-2 pr-2">
                  <AnswerPill person={person} />
                  {person.answer?.afterDeadline ? (
                    <span className="block text-xs text-muted-ink">
                      {t("afterDeadline")}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 [overflow-wrap:anywhere] whitespace-pre-line">
                  {person.answer?.reason}
                </td>
                <td className="py-2 pr-2 [overflow-wrap:anywhere] whitespace-pre-line text-muted-ink">
                  {person.answer?.comment}
                </td>
                <td className="py-2 text-muted-ink">
                  {person.answer
                    ? answeredAt(person.answer.updatedAt, timezone)
                    : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul>
          {people.items.map((person) => (
            <PersonCard
              key={person.inviteeId}
              slug={slug}
              person={person}
              timezone={timezone}
            />
          ))}
        </ul>
      )}
      <ShowMore
        hasMore={people.hasMore}
        loading={people.isLoadingMore}
        onMore={people.loadMore}
        endLabel={people.items.length > 0 ? t("listEnd") : undefined}
      />
    </Card>
  );
}
