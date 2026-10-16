import type { Meeting, UpdateMeetingBody } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import type { EditDraft } from "./use-edit-draft";

/** Draft wizard (spec §7.2). */
export const WIZARD_STEPS = [
  "details",
  "audience",
  "responses",
  "review",
] as const;
/** "Invite more people" on a sent meeting reuses the Audience and Review steps. */
export const INVITE_MORE_STEPS = ["audience", "review"] as const;
/** Editing a sent meeting (spec §7.5): Details, Answers, then Review changes. */
export const EDIT_STEPS = ["details", "responses", "changes"] as const;

/** One wizard step, in any mode. */
export type WizardStep = (typeof WIZARD_STEPS)[number] | "changes";
/** Draft wizard, Invite more, or editing a sent meeting. */
export type WizardMode = "draft" | "invite" | "edit";

/** Steps of a mode (a sent meeting is never back in the draft steps). */
export function stepsFor(
  status: Meeting["status"],
  mode: WizardMode,
): readonly WizardStep[] {
  if (status === "draft") {
    return WIZARD_STEPS;
  }
  return mode === "edit" ? EDIT_STEPS : INVITE_MORE_STEPS;
}

/** The `?step=` value if it is available, else the first step. */
export function resolveStep(
  param: string | null,
  steps: readonly WizardStep[],
): WizardStep {
  return steps.find((step) => step === param) ?? steps[0];
}

/** The step after `step` in `steps`, or null at the end. */
export function stepAfter(
  steps: readonly WizardStep[],
  step: WizardStep,
): WizardStep | null {
  return steps[steps.indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null at the start. */
export function stepBefore(
  steps: readonly WizardStep[],
  step: WizardStep,
): WizardStep | null {
  const index = steps.indexOf(step);
  return index > 0 ? steps[index - 1] : null;
}

/** How a step keeps its fields: PATCH for drafts, the session edit draft for sent meetings. */
export type StepSaver = {
  save: (patch: UpdateMeetingBody, onSaved?: () => void) => void;
  pending: boolean;
  failed: boolean;
};

/** Props every step component receives from the shell. */
export type WizardStepProps = {
  slug: string;
  /** The meeting as the step shows it (in edit mode, with unsaved edits applied). */
  meeting: Meeting;
  /** The meeting as the server has it. */
  saved: Meeting;
  workspace: WorkspaceDetails;
  steps: readonly WizardStep[];
  goTo: (step: WizardStep) => void;
  mode: WizardMode;
  saver: StepSaver;
  /** Unsaved edits of a sent meeting (edit mode only). */
  editDraft: EditDraft | null;
};
