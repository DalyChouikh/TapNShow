"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeeting, useMeetingProgress } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { InviteeList } from "./invitee-list";
import { MeetingHeader } from "./meeting-header";
import { SendProgress } from "./send-progress";

/** `/w/[slug]/meetings/[id]` (spec §7.2): details, live send progress, invitees, Invite more. */
export default function MeetingPage() {
  const t = useTranslations("MeetingPage");
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  const progress = useMeetingProgress(
    slug,
    id,
    meeting.data?.status === "scheduled",
  );
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
  return (
    <div className="flex flex-col gap-4">
      <MeetingHeader meeting={meeting.data} />
      {progress.data ? (
        <SendProgress
          slug={slug}
          progress={progress.data}
          canConnect={workspace.data.myRole === "owner"}
        />
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
      {canEdit && meeting.data.status === "scheduled" && !started ? (
        <Button asChild tone="primary" className="justify-center">
          <Link href={`/w/${slug}/meetings/${id}/edit?step=audience`}>
            {t("inviteMore")}
          </Link>
        </Button>
      ) : null}
      {progress.data ? <InviteeList invitees={progress.data.invitees} /> : null}
    </div>
  );
}
