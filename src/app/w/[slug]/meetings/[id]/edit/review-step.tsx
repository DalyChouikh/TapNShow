"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { WizardFooter } from "./wizard-footer";
import type { WizardStepProps } from "./wizard-steps";

/** Placeholder until its task replaces it (the meetings flag keeps it off production). */
export function ReviewStep({ steps, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const index = steps.indexOf("review");
  const previous = steps[index - 1];
  const next = steps[index + 1];
  return (
    <>
      <Card>{t("steps.review")}</Card>
      <WizardFooter
        backLabel={t("back")}
        onBack={() => (previous ? goTo(previous) : history.back())}
        nextLabel={
          next && next !== "details" ? t(`next.${next}`) : t("steps.review")
        }
        onNext={() => next && goTo(next)}
        nextDisabled={!next}
      />
    </>
  );
}
