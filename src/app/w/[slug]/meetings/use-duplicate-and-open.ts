"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useDuplicateMeeting } from "@/hooks/use-meetings";
import { ApiClientError } from "@/lib/api-client";

/**
 * Duplicate (spec §7.9) from a card or the meeting page: copy, say so, and open the copy's Details
 * to pick a date. No confirm: it only creates a private draft.
 */
export function useDuplicateAndOpen(slug: string) {
  const t = useTranslations("Meetings");
  const tErrors = useTranslations("ApiErrors");
  const router = useRouter();
  const duplicate = useDuplicateMeeting(slug);
  const open = (meetingId: string) =>
    duplicate.mutate(meetingId, {
      onSuccess: ({ id }) => {
        toast.success(t("duplicated"));
        router.push(`/w/${slug}/meetings/${id}/edit?step=details`);
      },
      onError: (error) =>
        toast.error(
          tErrors(error instanceof ApiClientError ? error.code : "internal"),
        ),
    });
  return { open, pending: duplicate.isPending };
}
