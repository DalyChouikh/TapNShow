"use client";

import { CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useWorkspaceInsights } from "@/hooks/use-results";
import { formatCalendarDay } from "@/lib/meetings/format";
import type { PeriodState } from "@/lib/responses/use-period";
import type { HistoryPerson } from "./person-history-dialog";

/**
 * "Often missing" (design §2.5), for every role: up to three roster members who missed the most
 * meetings in the period (absent or no reply), each asking Home to open their history. Hidden
 * when nobody missed anything, and while loading or failed (How it's going shows that state for
 * the same request).
 */
export function OftenMissing({
  slug,
  period,
  onOpen,
}: {
  slug: string;
  period: PeriodState;
  onOpen: (person: HistoryPerson) => void;
}) {
  const t = useTranslations("WorkspaceHome.oftenMissing");
  const tPeriods = useTranslations("History.periods");
  const insights = useWorkspaceInsights(slug, period.range);
  const people = insights.data?.oftenMissing ?? [];
  if (people.length === 0) {
    return null;
  }
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-xl">{t("title")}</h2>
        <p className="text-sm text-muted-ink">
          {period.period === "custom"
            ? t("customRange", {
                from: formatCalendarDay(period.custom.from),
                to: formatCalendarDay(period.custom.to),
              })
            : tPeriods(period.period)}
        </p>
      </div>
      <ul className="flex flex-col">
        {people.map((member) => (
          <li key={member.contactId}>
            <button
              type="button"
              onClick={() => onOpen(member)}
              className="flex min-h-11 w-full items-center gap-3 rounded-control py-2 text-left hover:bg-fill-neutral/40"
            >
              <Avatar
                name={member.fullName}
                email={null}
                className="bg-fill-danger"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold break-words">{member.fullName}</span>
                <span className="text-sm text-muted-ink">
                  {t("missed", {
                    missed: member.missed,
                    invited: member.invited,
                    absent: member.absent,
                    noReply: member.noReply,
                  })}
                </span>
              </span>
              <CaretRight weight="bold" aria-hidden className="shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      <Link
        href={`/w/${slug}/lists?view=attendance`}
        className="flex min-h-11 items-center gap-1 self-start text-sm font-bold underline underline-offset-4"
      >
        {t("seeAll")}
        <CaretRight weight="bold" aria-hidden />
      </Link>
    </Card>
  );
}
