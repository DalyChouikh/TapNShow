"use client";

import { CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { initialsFor } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Sticker } from "@/components/ui/sticker";
import { formatDeadline } from "@/lib/meetings/format";
import { describeInvite } from "@/lib/my-invites/describe";
import { cn } from "@/lib/utils";
import type { MyInvite, MyInvitesTab } from "@/shared/api/my-invites";

/**
 * One invite (spec §7.4): the group's initials, the title, "<Group> · <day, time>" in the
 * meeting's zone, and its pills. Upcoming cards open the invite; Past cards don't (answers close
 * at the start). `disabled` (offline) keeps the card readable but not openable.
 */
export function InviteCard({
  invite,
  tab,
  disabled = false,
}: {
  invite: MyInvite;
  tab: MyInvitesTab;
  disabled?: boolean;
}) {
  const t = useTranslations("MyInvites");
  const pills = describeInvite(invite, tab);
  const opens = tab === "upcoming" && !disabled;
  const body = (
    <Card
      as="article"
      className={cn(
        "flex flex-col gap-2",
        invite.status === "cancelled" && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <Sticker tone="primary">
          <span className="text-xs font-bold">
            {initialsFor(invite.workspaceName, null)}
          </span>
        </Sticker>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold">{invite.title}</h3>
          <p className="text-sm break-words text-muted-ink">
            {invite.workspaceName} ·{" "}
            {formatDeadline(invite.startsAt, invite.timezone)}
          </p>
        </div>
        {opens ? <CaretRight weight="bold" aria-hidden /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pills.map((pill) => (
          <Pill key={pill.key} tone={pill.tone}>
            {t(`pill.${pill.key}`, pill.values)}
          </Pill>
        ))}
        {pills[0]?.key === "timeChanged" && invite.answer ? (
          <span className="text-sm text-muted-ink">
            {t("pill.timeChangedHint", { answer: invite.answer.status })}
          </span>
        ) : null}
      </div>
      {tab === "past" && invite.answer?.reason ? (
        <p className="text-sm break-words text-muted-ink">
          {t("yourReason", { reason: invite.answer.reason })}
        </p>
      ) : null}
    </Card>
  );
  return opens ? (
    <Link
      href={`/invites/${invite.inviteeId}`}
      className="block rounded-card focus-visible:outline-offset-4"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
