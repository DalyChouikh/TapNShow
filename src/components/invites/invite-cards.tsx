"use client";

import { WarningCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/**
 * An invite opened while signed in with another address (workspace and admin invites): names the
 * invited address (masked) and offers to switch account.
 */
export function InviteWrongAccountCard({
  email,
  pending,
  onSwitch,
}: {
  email: string;
  pending: boolean;
  onSwitch: () => void;
}) {
  const t = useTranslations("InvitePage");
  return (
    <Card as="section" className="flex flex-col gap-3">
      <Sticker tone="warning">
        <WarningCircle weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl">{t("wrongTitle", { email })}</h1>
      <p>{t("wrongBody")}</p>
      <Button tone="primary" disabled={pending} onClick={onSwitch}>
        {t("switchAccount")}
      </Button>
    </Card>
  );
}

/** Why an invite link can't be used (both invite pages). */
export type ClosedInviteStatus = "expired" | "revoked" | "used" | "not_found";

const CLOSED_MESSAGE = {
  expired: "expired",
  revoked: "revoked",
  used: "used",
  not_found: "notFound",
} as const;

/** An invite that can't be used any more: why, in one line. */
export function InviteClosedCard({ status }: { status: ClosedInviteStatus }) {
  const t = useTranslations("InvitePage");
  return (
    <Card as="section" className="flex flex-col gap-3">
      <Sticker tone="neutral">
        <WarningCircle weight="bold" />
      </Sticker>
      <p className="font-bold">{t(CLOSED_MESSAGE[status])}</p>
    </Card>
  );
}
