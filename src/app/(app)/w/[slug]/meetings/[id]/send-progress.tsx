"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { MeetingResults } from "@/shared/api/responses";
import { googleConnectHref } from "@/shared/api/google-connect";

/**
 * Live send progress (spec §7.2): a bar, one caption for the current state, the bounce note. While
 * the workspace's sending is paused for review (spec §7.12) that is the caption, and connecting
 * Gmail isn't offered (it wouldn't help).
 */
export function SendProgress({
  slug,
  results,
  canConnect,
  suspended,
}: {
  slug: string;
  results: MeetingResults;
  canConnect: boolean;
  suspended: boolean;
}) {
  const t = useTranslations("MeetingPage");
  const progress = results;
  const counts = results.emails;
  const done = counts.total - counts.queued;
  // Paused for review only matters to emails still waiting; a fully sent meeting reads as sent.
  const held = suspended && (counts.queued > 0 || progress.paused > 0);
  const paused = held || progress.paused > 0 || progress.senderState !== "ok";
  const caption = held
    ? t("pausedSuspended")
    : paused
      ? progress.senderState === "broken"
        ? t("pausedBroken")
        : t("pausedMissing")
      : progress.resumesAt
        ? t("queuedResume", {
            count: counts.queued,
            time: format(new Date(progress.resumesAt), "HH:mm"),
          })
        : counts.queued > 0
          ? t("sending", { done, total: counts.total })
          : counts.failed + counts.unknown > 0
            ? t("doneWithIssues", {
                sent: counts.sent,
                failed: counts.failed,
                unknown: counts.unknown,
              })
            : t("done", { count: counts.sent });
  const tone = paused
    ? "bg-fill-warning"
    : counts.queued > 0
      ? "bg-fill-info"
      : "bg-fill-success";
  return (
    <Card
      as="section"
      aria-live="polite"
      className={`flex flex-col gap-2 text-on-fill ${tone}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg">{t("progressTitle")}</h2>
        <span className="font-bold">
          {done} / {counts.total}
        </span>
      </div>
      <ProgressBar label={t("progressTitle")} value={done} max={counts.total} />
      <p className="font-bold">{caption}</p>
      {counts.queued > 0 && !paused ? (
        <p className="text-sm">{t("leave")}</p>
      ) : null}
      {paused && canConnect && !suspended ? (
        <Button asChild tone="primary">
          <a href={googleConnectHref(slug, "sending")}>{t("connect")}</a>
        </Button>
      ) : null}
      <p className="text-sm">{t("bounces")}</p>
    </Card>
  );
}
