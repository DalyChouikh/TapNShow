"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { ComingSoon } from "@/components/shell/coming-soon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEnv } from "@/config/public-env";
import { useCreateMeeting } from "@/hooks/use-meetings";

/** "+" target: creates one draft, then opens the wizard on it (spec §7.2). */
export default function NewMeetingPage() {
  const t = useTranslations("Meetings");
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const create = useCreateMeeting(slug);
  const started = useRef(false);
  const start = () =>
    create.mutate(undefined, {
      onSuccess: ({ id }) =>
        router.replace(`/w/${slug}/meetings/${id}/edit?step=details`),
    });
  useEffect(() => {
    // Strict Mode runs effects twice in development; one draft per visit.
    if (!started.current && publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
      started.current = true;
      start();
    }
  });
  if (!publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED) {
    return <ComingSoon area="meetings" />;
  }
  if (create.isError) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="font-bold">{t("createFailed")}</p>
        <Button tone="primary" onClick={start}>
          {t("retry")}
        </Button>
      </Card>
    );
  }
  return (
    <div aria-busy="true" aria-label={t("creating")}>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
