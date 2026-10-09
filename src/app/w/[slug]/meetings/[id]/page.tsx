"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ExportMenu } from "@/components/forms/export-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeeting } from "@/hooks/use-meetings";
import { useMeetingResults } from "@/hooks/use-results";
import { useWorkspace } from "@/hooks/use-workspace";
import { isLive } from "@/lib/responses/live-window";
import type { Meeting } from "@/shared/api/meetings";
import type { PeopleFilter } from "@/shared/api/responses";
import { DeliverySheet } from "./delivery-sheet";
import { EmailLine } from "./email-line";
import { MeetingHeader } from "./meeting-header";
import { PeopleList } from "./people-list";
import { ResultTiles } from "./result-tiles";
import { SendProgress } from "./send-progress";
import { useExportAnswers } from "./use-export-answers";

/** Export of every answer (the hook needs the loaded meeting). */
function MeetingExport({ slug, meeting }: { slug: string; meeting: Meeting }) {
  const exportAnswers = useExportAnswers(slug, meeting);
  return <ExportMenu onExport={exportAnswers} />;
}

/**
 * `/w/[slug]/meetings/[id]` (spec §7.2, §7.7): details, send progress or the email line, answer
 * tiles that filter the people below, live while the meeting is near, and Invite more.
 */
export default function MeetingPage() {
  const t = useTranslations("MeetingPage");
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  const live =
    meeting.data?.status === "scheduled" && isLive(meeting.data, new Date());
  const results = useMeetingResults(slug, id, live);
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  useEffect(() => {
    if (meeting.data?.status === "draft") {
      router.replace(`/w/${slug}/meetings/${id}/edit`);
    }
  }, [id, meeting.data?.status, router, slug]);
  if (!meeting.data || !workspace.data || meeting.data.status === "draft") {
    return <Skeleton className="h-96 w-full" />;
  }
  const canEdit = workspace.data.myRole !== "viewer";
  const started =
    meeting.data.startsAt !== null &&
    new Date(meeting.data.startsAt) <= new Date();
  const sending = results.data
    ? results.data.emails.queued > 0 || results.data.paused > 0
    : false;
  return (
    <div className="flex flex-col gap-4">
      <MeetingHeader
        meeting={meeting.data}
        actions={
          meeting.data.responseMode !== "announcement" ? (
            <MeetingExport slug={slug} meeting={meeting.data} />
          ) : null
        }
      />
      {!results.data ? (
        <Skeleton className="h-32 w-full" />
      ) : sending ? (
        <SendProgress
          slug={slug}
          results={results.data}
          canConnect={workspace.data.myRole === "owner"}
        />
      ) : (
        <EmailLine
          emails={results.data.emails}
          onOpen={() => setDeliveryOpen(true)}
        />
      )}
      {results.data ? (
        <ResultTiles
          results={results.data}
          filter={filter}
          onFilter={setFilter}
        />
      ) : null}
      {results.data && results.data.responseMode !== "announcement" ? (
        <PeopleList
          slug={slug}
          meetingId={id}
          filter={filter}
          live={live}
          timezone={meeting.data.timezone}
        />
      ) : null}
      {canEdit && meeting.data.status === "scheduled" && !started ? (
        <Button asChild tone="primary" className="justify-center">
          <Link href={`/w/${slug}/meetings/${id}/edit?step=audience`}>
            {t("inviteMore")}
          </Link>
        </Button>
      ) : null}
      {deliveryOpen ? (
        <DeliverySheet
          slug={slug}
          meetingId={id}
          open={deliveryOpen}
          onOpenChange={setDeliveryOpen}
        />
      ) : null}
    </div>
  );
}
