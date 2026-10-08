"use client";

import { CalendarDots, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { useMeetings } from "@/hooks/use-meetings";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { partitionMeetings } from "@/lib/meetings/partition";
import type { MeetingSummary } from "@/shared/api/meetings";
import { DraftMenu } from "./draft-menu";

type Tab = "upcoming" | "drafts" | "past";

/** The Meetings page body. */
export function MeetingsList({ slug }: { slug: string }) {
  const t = useTranslations("Meetings");
  const workspace = useWorkspace(slug);
  const meetings = useMeetings(slug);
  const [tab, setTab] = useState<Tab>("upcoming");
  const groups = useMemo(
    () => partitionMeetings(meetings.data ?? [], new Date()),
    [meetings.data],
  );
  const canEdit = workspace.data && workspace.data.myRole !== "viewer";
  if (!meetings.data || !workspace.data) {
    return <Skeleton className="h-64 w-full" />;
  }
  const tabs: Tab[] = canEdit
    ? ["upcoming", "drafts", "past"]
    : ["upcoming", "past"];
  const shown = groups[tab];
  const hrefFor = (m: MeetingSummary) =>
    m.status === "draft"
      ? `/w/${slug}/meetings/${m.id}/edit`
      : `/w/${slug}/meetings/${m.id}`;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        {canEdit ? (
          <Button asChild tone="primary" className="whitespace-nowrap">
            <Link href={`/w/${slug}/meetings/new`}>
              <Plus weight="bold" aria-hidden />
              {t("new")}
            </Link>
          </Button>
        ) : null}
      </div>
      <SegmentedControl
        label={t("tabs.label")}
        value={tab}
        onValueChange={(next) =>
          setTab(tabs.find((item) => item === next) ?? "upcoming")
        }
        options={tabs.map((item) => ({
          value: item,
          label: t(`tabs.${item}`),
        }))}
      />
      {shown.length === 0 ? (
        <Card className="flex items-center gap-3">
          <Sticker tone="neutral">
            <CalendarDots weight="bold" />
          </Sticker>
          <p className="text-muted-ink">{t(`empty.${tab}`)}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((meeting) => {
            const when = meeting.startsAt
              ? formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt })
              : null;
            return (
              <li key={meeting.id} className="relative">
                <Link
                  href={hrefFor(meeting)}
                  className="block rounded-card focus-visible:outline-2"
                >
                  <Card
                    className={cn(
                      "flex flex-col gap-1",
                      // Room for the draft's "…" button in the corner.
                      meeting.status === "draft" && canEdit && "pr-14",
                    )}
                  >
                    <span className="font-display text-lg break-words">
                      {meeting.title || t("untitled")}
                    </span>
                    <span className="text-sm text-muted-ink">
                      {when
                        ? `${when.date}, ${when.start}–${when.end}`
                        : t("noDate")}
                    </span>
                    <span className="text-sm font-bold">
                      {meeting.status === "draft"
                        ? t("draft")
                        : t("sent", {
                            sent: meeting.sentCount,
                            total: meeting.invitedCount,
                          })}
                    </span>
                  </Card>
                </Link>
                {meeting.status === "draft" && canEdit ? (
                  <DraftMenu
                    slug={slug}
                    meetingId={meeting.id}
                    title={meeting.title || t("untitled")}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
