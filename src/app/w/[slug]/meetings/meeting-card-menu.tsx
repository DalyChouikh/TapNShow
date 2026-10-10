"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteMeeting, useDuplicateMeeting } from "@/hooks/use-meetings";
import { ApiClientError } from "@/lib/api-client";
import type { MeetingSummary } from "@/shared/api/meetings";

/**
 * "…" on a meeting card for Owners and Admins: Duplicate on every card (spec §7.9; no confirm, it
 * only creates a private draft), plus Delete draft on drafts after an "Are you sure?".
 */
export function MeetingCardMenu({
  slug,
  meeting,
}: {
  slug: string;
  meeting: MeetingSummary;
}) {
  const t = useTranslations("Meetings");
  const tr = useTranslations("Wizard.review");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const remove = useDeleteMeeting(slug);
  const duplicate = useDuplicateMeeting(slug);
  const [confirming, setConfirming] = useState(false);
  const title = meeting.title || t("untitled");
  const copy = () =>
    duplicate.mutate(meeting.id, {
      onSuccess: ({ id }) => {
        toast.success(t("duplicated"));
        router.push(`/w/${slug}/meetings/${id}/edit?step=details`);
      },
      onError: (error) =>
        toast.error(
          tErrors(error instanceof ApiClientError ? error.code : "internal"),
        ),
    });
  return (
    <div className="absolute top-2 right-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("cardActions", { title })}
          className="inline-flex size-11 items-center justify-center rounded-control"
        >
          <DotsThree weight="bold" aria-hidden className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={duplicate.isPending} onSelect={copy}>
            {t("duplicate")}
          </DropdownMenuItem>
          {meeting.status === "draft" ? (
            <DropdownMenuItem onSelect={() => setConfirming(true)}>
              {tr("deleteDraft")}
            </DropdownMenuItem>
          ) : null}
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
          remove.mutate(meeting.id, { onSuccess: () => setConfirming(false) })
        }
      />
    </div>
  );
}
