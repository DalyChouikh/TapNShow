import type { ComponentType } from "react";
import { useEditDraft } from "@/app/w/[slug]/meetings/[id]/edit/use-edit-draft";
import { useStepSaver } from "@/app/w/[slug]/meetings/[id]/edit/use-step-saver";
import type {
  WizardMode,
  WizardStep,
  WizardStepProps,
} from "@/app/w/[slug]/meetings/[id]/edit/wizard-steps";
import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/**
 * Renders one wizard step the way the shell does: the real saver (PATCH for drafts, the session
 * edit draft in edit mode) and, in edit mode, the meeting with its unsaved edits applied.
 */
export function StepHarness({
  Step,
  slug,
  meeting,
  workspace,
  steps,
  goTo,
  mode = "draft",
}: {
  Step: ComponentType<WizardStepProps>;
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  steps: readonly WizardStep[];
  goTo: (step: WizardStep) => void;
  mode?: WizardMode;
}) {
  const editDraft = useEditDraft(meeting);
  const saver = useStepSaver(slug, meeting.id, mode, editDraft);
  return (
    <Step
      slug={slug}
      meeting={mode === "edit" ? editDraft.view : meeting}
      saved={meeting}
      workspace={workspace}
      steps={steps}
      goTo={goTo}
      mode={mode}
      saver={saver}
      editDraft={mode === "edit" ? editDraft : null}
    />
  );
}
