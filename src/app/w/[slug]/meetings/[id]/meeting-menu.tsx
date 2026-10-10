"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCancelMeeting } from "@/hooks/use-meeting-lifecycle";
import { useDeleteMeeting } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { errorCodeOf } from "@/lib/api-client";
import type { Meeting } from "@/shared/api/meetings";
import type { MeetingResults } from "@/shared/api/responses";
import { useDuplicateAndOpen } from "../use-duplicate-and-open";

/** The meeting page's "…" (spec §7.5, §7.9): Edit, Duplicate, Cancel meeting, Delete. Owners and Admins. */
export function MeetingMenu({
  slug,
  meeting,
  results,
}: {
  slug: string;
  meeting: Meeting;
  results: MeetingResults | undefined;
}) {
  const t = useTranslations("MeetingPage");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const workspace = useWorkspace(slug);
  const cancel = useCancelMeeting(slug, meeting.id);
  const remove = useDeleteMeeting(slug);
  const duplicate = useDuplicateAndOpen(slug);
  const [dialog, setDialog] = useState<"cancel" | "delete" | null>(null);
  if (!workspace.data || workspace.data.myRole === "viewer") {
    return null;
  }
  const started =
    meeting.startsAt !== null && new Date(meeting.startsAt) <= new Date();
  const open = meeting.status === "scheduled" && !started;
  const reachable = results?.answers.reachable ?? 0;
  const errorOf = (error: Error | null) =>
    error ? tErrors(errorCodeOf(error)) : null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("menu.label")}
          className="inline-flex size-11 items-center justify-center rounded-control"
        >
          <DotsThree weight="bold" aria-hidden className="size-6" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {open ? (
            <DropdownMenuItem
              onSelect={() =>
                router.push(
                  `/w/${slug}/meetings/${meeting.id}/edit?mode=edit&step=details`,
                )
              }
            >
              {t("menu.edit")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={duplicate.pending}
            onSelect={() => duplicate.open(meeting.id)}
          >
            {t("menu.duplicate")}
          </DropdownMenuItem>
          {open ? (
            <DropdownMenuItem onSelect={() => setDialog("cancel")}>
              {t("menu.cancel")}
            </DropdownMenuItem>
          ) : null}
          {meeting.status === "cancelled" ? (
            <DropdownMenuItem onSelect={() => setDialog("delete")}>
              {t("menu.delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(next) => setDialog(next ? "cancel" : null)}
        title={
          reachable > 0
            ? t("cancel.title", { count: reachable })
            : t("cancel.titleNobody")
        }
        description={t("cancel.body")}
        confirmLabel={t("cancel.confirm")}
        cancelLabel={t("cancel.keep")}
        tone="danger"
        pending={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: ({ emails }) => {
              setDialog(null);
              toast.success(
                emails > 0
                  ? t("cancel.done", { count: emails })
                  : t("cancel.doneNobody"),
              );
            },
          })
        }
      >
        {cancel.error ? (
          <p role="alert" className="font-bold">
            {errorOf(cancel.error)}
          </p>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(next) => setDialog(next ? "delete" : null)}
        title={t("delete.title")}
        description={t("delete.body")}
        confirmLabel={t("delete.confirm")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(meeting.id, {
            onSuccess: () => router.push(`/w/${slug}/meetings`),
          })
        }
      >
        {remove.error ? (
          <p role="alert" className="font-bold">
            {errorOf(remove.error)}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
