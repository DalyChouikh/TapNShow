"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteMeeting } from "@/hooks/use-meetings";

/** "…" on a draft card: Delete draft, after an "Are you sure?" (grilling 2026-10-07). */
export function DraftMenu({
  slug,
  meetingId,
  title,
}: {
  slug: string;
  meetingId: string;
  title: string;
}) {
  const t = useTranslations("Meetings");
  const tr = useTranslations("Wizard.review");
  const remove = useDeleteMeeting(slug);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="absolute top-2 right-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("draftActions", { title })}
          className="inline-flex size-11 items-center justify-center rounded-control"
        >
          <DotsThree weight="bold" aria-hidden className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setConfirming(true)}>
            {tr("deleteDraft")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={tr("deleteTitle")}
        description={tr("deleteBody")}
        confirmLabel={tr("deleteDraft")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(meetingId, { onSuccess: () => setConfirming(false) })
        }
      />
    </div>
  );
}
