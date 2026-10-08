import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Draft wizard (spec §7.2). */
export const WIZARD_STEPS = [
  "details",
  "audience",
  "responses",
  "review",
] as const;
/** "Invite more people" on a sent meeting reuses the Audience and Review steps. */
export const INVITE_MORE_STEPS = ["audience", "review"] as const;

/** One wizard step. */
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Steps available for a meeting's status. */
export function stepsFor(status: Meeting["status"]): readonly WizardStep[] {
  return status === "draft" ? WIZARD_STEPS : INVITE_MORE_STEPS;
}

/** The `?step=` value if it is available, else the first step. */
export function resolveStep(
  param: string | null,
  steps: readonly WizardStep[],
): WizardStep {
  return steps.find((step) => step === param) ?? steps[0];
}

/** Props every step component receives from the shell. */
export type WizardStepProps = {
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  steps: readonly WizardStep[];
  goTo: (step: WizardStep) => void;
};
