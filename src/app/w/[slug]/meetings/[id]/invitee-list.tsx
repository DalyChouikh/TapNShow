"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AUDIENCE_PAGE_SIZE } from "@/config/meetings";
import { cn } from "@/lib/utils";
import type { MeetingProgress } from "@/shared/api/meetings";

type Invitee = MeetingProgress["invitees"][number];

const PILL: Record<Invitee["status"], string> = {
  sent: "bg-fill-success",
  queued: "bg-fill-neutral",
  skipped: "bg-fill-neutral",
  failed: "bg-fill-danger",
  unknown: "bg-fill-warning",
};

const KNOWN_REASONS = [
  "unsubscribed",
  "meeting_cancelled",
  "meeting_started",
  "delivery_unknown",
] as const;

/** Maps a stored delivery error to a reason key (Gmail's own messages read as "refused"). */
function reasonKey(
  error: string | null,
): (typeof KNOWN_REASONS)[number] | "other" {
  return KNOWN_REASONS.find((reason) => reason === error) ?? "other";
}

/** Invited people with their delivery state (spec §7.2 meeting page). */
export function InviteeList({ invitees }: { invitees: Invitee[] }) {
  const t = useTranslations("MeetingPage");
  const tAudience = useTranslations("Wizard.audience");
  const [shown, setShown] = useState(AUDIENCE_PAGE_SIZE);
  return (
    <Card as="section" className="flex flex-col gap-2">
      <h2 className="font-display text-lg">{t("invitees")}</h2>
      <ul>
        {invitees.slice(0, shown).map((invitee) => (
          <li
            key={invitee.id}
            className="flex items-center gap-3 border-b border-dashed border-outline/30 py-2 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-bold break-words">{invitee.fullName}</span>
              <span className="truncate text-sm text-muted-ink">
                {invitee.email}
              </span>
              {invitee.status === "failed" ||
              invitee.status === "unknown" ||
              invitee.status === "skipped" ? (
                <span className="text-sm">
                  {t(`reason.${reasonKey(invitee.error)}`)}
                </span>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
                PILL[invitee.status],
              )}
            >
              {t(`status.${invitee.status}`)}
            </span>
          </li>
        ))}
      </ul>
      {invitees.length > shown ? (
        <Button onClick={() => setShown((count) => count + AUDIENCE_PAGE_SIZE)}>
          {tAudience("showMore", {
            count: Math.min(AUDIENCE_PAGE_SIZE, invitees.length - shown),
          })}
        </Button>
      ) : null}
    </Card>
  );
}
