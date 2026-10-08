"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { gmailConnectHref } from "@/hooks/use-sender";
import type { MeetingResults } from "@/shared/api/responses";

/** Live send progress (spec §7.2): a bar, one caption for the current state, the bounce note. */
export function SendProgress({
  slug,
  results,
  canConnect,
}: {
  slug: string;
  results: MeetingResults;
  canConnect: boolean;
}) {
  const t = useTranslations("MeetingPage");
  const progress = results;
  const counts = results.emails;
  const done = counts.total - counts.queued;
  const paused = progress.paused > 0 || progress.senderState !== "ok";
  const caption = paused
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
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={done}
        className="h-4 overflow-hidden rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface"
      >
        <div
          className="h-full border-r-[length:var(--tn-border-width)] border-outline bg-fill-primary transition-[width] motion-reduce:transition-none"
          style={{
            width: `${counts.total ? (done / counts.total) * 100 : 0}%`,
          }}
        />
      </div>
      <p className="font-bold">{caption}</p>
      {counts.queued > 0 && !paused ? (
        <p className="text-sm">{t("leave")}</p>
      ) : null}
      {paused && canConnect ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(slug)}>{t("connect")}</a>
        </Button>
      ) : null}
      <p className="text-sm">{t("bounces")}</p>
    </Card>
  );
}
