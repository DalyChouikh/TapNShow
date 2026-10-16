"use client";

import { CaretRight } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MeetingResults } from "@/shared/api/responses";

/** "Emails: 29 sent · 1 not delivered ▸" once invites are out; opens the delivery sheet. */
export function EmailLine({
  emails,
  onOpen,
}: {
  emails: MeetingResults["emails"];
  onOpen: () => void;
}) {
  const t = useTranslations("MeetingPage");
  const issues = emails.failed + emails.skipped + emails.unknown;
  return (
    <div className="flex flex-col gap-1">
      <Button className="w-full" onClick={onOpen}>
        {issues > 0
          ? t("results.emailLineIssues", { sent: emails.sent, issues })
          : t("results.emailLine", { sent: emails.sent })}
        <CaretRight weight="bold" aria-hidden />
      </Button>
      {emails.failed + emails.unknown > 0 ? (
        <p className="text-sm text-muted-ink">{t("bounces")}</p>
      ) : null}
    </div>
  );
}
