"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRequestCalendar } from "@/hooks/use-token-page";
import type { TokenInfo } from "@/shared/api/tokens";
import { CalendarLinks } from "./calendar-links";

/** Announcements: no answer, only "Email me a calendar invite" and the calendar links (spec §7.3). */
export function AnnouncementCalendar({
  token,
  info,
}: {
  token: string;
  info: TokenInfo;
}) {
  const t = useTranslations("AnswerPage");
  const request = useRequestCalendar(token);
  return (
    <section className="flex flex-col gap-3">
      <p>{t("announcement")}</p>
      {info.unsubscribed ? (
        <p className="text-sm">
          {t("calendarUnsubscribed", { workspace: info.workspaceName })}{" "}
          <Link href={`/u/${token}`} className="font-bold underline">
            {t("subscribeAgain")}
          </Link>
        </p>
      ) : info.calendarRequested ? (
        <p role="status" className="font-bold">
          {t("calendarSent")}
        </p>
      ) : (
        <Button
          tone="primary"
          size="lg"
          className="justify-center"
          disabled={request.isPending}
          aria-busy={request.isPending}
          onClick={() => request.mutate()}
        >
          {request.isPending ? t("saving") : t("announcementCalendar")}
        </Button>
      )}
      {request.isError ? (
        <p role="alert" className="font-bold">
          {t("saveFailed")}
        </p>
      ) : null}
      <CalendarLinks token={token} meeting={info.meeting} />
    </section>
  );
}
