"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { AudienceStep } from "./audience-step";
import { DetailsStep } from "./details-step";
import { ResponsesStep } from "./responses-step";
import { ReviewStep } from "./review-step";
import { resolveStep, stepsFor, type WizardStep } from "./wizard-steps";
import type { Meeting } from "@/shared/api/meetings";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

const STEP_COMPONENTS = {
  details: DetailsStep,
  audience: AudienceStep,
  responses: ResponsesStep,
  review: ReviewStep,
} as const;

/** Header ("Step 2 of 4" + title) and the current step; the step lives in the URL. */
export function WizardShell({
  slug,
  meeting,
  workspace,
  stepParam,
}: {
  slug: string;
  meeting: Meeting;
  workspace: WorkspaceDetails;
  stepParam: string | null;
}) {
  const t = useTranslations("Wizard");
  const router = useRouter();
  const steps = stepsFor(meeting.status);
  const step = resolveStep(stepParam, steps);
  const goTo = (next: WizardStep) => {
    router.replace(`/w/${slug}/meetings/${meeting.id}/edit?step=${next}`, {
      scroll: true,
    });
  };
  useEffect(() => {
    if (workspace.myRole === "viewer" || meeting.status === "cancelled") {
      router.replace(`/w/${slug}/meetings/${meeting.id}`);
    }
  }, [meeting.id, meeting.status, router, slug, workspace.myRole]);
  const Step = STEP_COMPONENTS[step];
  return (
    <section className="flex flex-col gap-4 pb-28">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-bold text-muted-ink">
          {t("stepOf", {
            current: steps.indexOf(step) + 1,
            total: steps.length,
          })}
        </p>
        <h1 className="font-display text-3xl">{t(`steps.${step}`)}</h1>
      </header>
      <Step
        slug={slug}
        meeting={meeting}
        workspace={workspace}
        steps={steps}
        goTo={goTo}
      />
    </section>
  );
}
