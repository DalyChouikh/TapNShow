"use client";

import { Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { useHasDrafts } from "@/hooks/use-meetings";
import { gmailConnectHref, useWorkspaceSender } from "@/hooks/use-sender";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Home "needs attention" (spec §7.2, §7.15): a broken sender, or drafts waiting for a sender. */
export function NeedsAttention({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("WorkspaceHome");
  const sender = useWorkspaceSender(workspace.slug);
  const isOwner = workspace.myRole === "owner";
  const hasDrafts = useHasDrafts(
    workspace.slug,
    isOwner && sender.data !== undefined && !sender.data.sender,
  );
  if (!sender.data || workspace.myRole === "viewer") {
    return null;
  }
  const broken = sender.data.sender?.status === "broken";
  const draftWaiting = isOwner && !sender.data.sender && hasDrafts;
  if (!broken && !draftWaiting) {
    return null;
  }
  return (
    <Card
      as="section"
      className="flex flex-col gap-3 bg-fill-warning text-on-fill"
    >
      <div className="flex items-center gap-3">
        <Sticker tone="warning">
          <Warning weight="bold" />
        </Sticker>
        <h2 className="font-display text-xl">{t("attentionTitle")}</h2>
      </div>
      <p className="font-bold">
        {broken ? t("attentionBroken") : t("attentionDraft")}
      </p>
      {isOwner ? (
        <Button asChild tone="primary">
          <a href={gmailConnectHref(workspace.slug)}>
            {broken ? t("reconnect") : t("connect")}
          </a>
        </Button>
      ) : (
        <p>{t("attentionAskOwner", { owner: sender.data.ownerName })}</p>
      )}
      <Link className="sr-only" href={`/w/${workspace.slug}/settings#sending`}>
        {t("connectGmail")}
      </Link>
    </Card>
  );
}
