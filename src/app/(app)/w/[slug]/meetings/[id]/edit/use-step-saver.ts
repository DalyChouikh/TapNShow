"use client";

import { useUpdateMeeting } from "@/hooks/use-meetings";
import type { EditDraft } from "./use-edit-draft";
import type { StepSaver, WizardMode } from "./wizard-steps";

/**
 * How the wizard's steps keep their fields: a draft PATCHes each step; editing a sent meeting keeps
 * the changes in the tab until Review changes saves them (spec §7.5), so nothing is sent early.
 */
export function useStepSaver(
  slug: string,
  meetingId: string,
  mode: WizardMode,
  editDraft: EditDraft,
): StepSaver {
  const update = useUpdateMeeting(slug, meetingId);
  if (mode === "edit") {
    return {
      save: (patch, onSaved) => {
        editDraft.save(patch);
        onSaved?.();
      },
      pending: false,
      failed: false,
    };
  }
  return {
    save: (patch, onSaved) =>
      update.mutate(patch, { onSuccess: () => onSaved?.() }),
    pending: update.isPending,
    failed: update.isError,
  };
}
