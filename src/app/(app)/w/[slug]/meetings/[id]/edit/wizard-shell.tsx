"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { AudienceStep } from "./audience-step";
import { ChangesStep } from "./changes-step";
import { DetailsStep } from "./details-step";
import { ResponsesStep } from "./responses-step";
import { ReviewStep } from "./review-step";
import { useEditDraft } from "./use-edit-draft";
import { useStepSaver } from "./use-step-saver";
import {
  resolveStep,
  stepsFor,
  type WizardMode,
  type WizardStep,
} from "./wizard-steps";
import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

const STEP_COMPONENTS = {
  details: DetailsStep,
  audience: AudienceStep,
  responses: ResponsesStep,
  review: ReviewStep,
  changes: ChangesStep,
} as const;

/**
 * Header ("Step 2 of 4" + title) and the current step; the step lives in the URL. A sent meeting
 * opens in Invite more, or with `?mode=edit` in the edit steps (spec §7.5).
 */
export function WizardShell({
  slug,
  meeting,
  workspace,
  stepParam,
  modeParam,
}: {
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  stepParam: string | null;
  modeParam: string | null;
}) {
  const t = useTranslations("Wizard");
  const router = useRouter();
  const mode: WizardMode =
    meeting.status === "draft"
      ? "draft"
      : modeParam === "edit"
        ? "edit"
        : "invite";
  const steps = stepsFor(meeting.status, mode);
  const step = resolveStep(stepParam, steps);
  const editDraft = useEditDraft(meeting);
  const saver = useStepSaver(slug, meeting.id, mode, editDraft);
  const goTo = (next: WizardStep) => {
    router.replace(
      `/w/${slug}/meetings/${meeting.id}/edit?${mode === "edit" ? "mode=edit&" : ""}step=${next}`,
      { scroll: true },
    );
  };
  useEffect(() => {
    // A started meeting can't be changed: an edit link opened late goes back to its page.
    const started =
      meeting.startsAt !== null &&
      new Date(meeting.startsAt).getTime() <= Date.now();
    if (
      workspace.myRole === "viewer" ||
      meeting.status === "cancelled" ||
      (mode === "edit" && started)
    ) {
      router.replace(`/w/${slug}/meetings/${meeting.id}`);
    }
  }, [
    meeting.id,
    meeting.startsAt,
    meeting.status,
    mode,
    router,
    slug,
    workspace.myRole,
  ]);
  const Step = STEP_COMPONENTS[step];
  return (
    <section className="flex flex-col gap-4 pb-28">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-bold text-muted-ink">
          {t(mode === "edit" ? "stepOfEdit" : "stepOf", {
            current: steps.indexOf(step) + 1,
            total: steps.length,
          })}
        </p>
        <h1 className="font-display text-3xl">{t(`steps.${step}`)}</h1>
      </header>
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
    </section>
  );
}
