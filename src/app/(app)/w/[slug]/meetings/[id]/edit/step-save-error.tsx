"use client";

import { useTranslations } from "next-intl";
import { errorCodeOf } from "@/lib/api-client";

/**
 * Why a wizard step couldn't save: the server's reason when it refused (e.g. a late time longer
 * than the meeting, too many people), or "try again" when the save didn't get through.
 */
export function StepSaveError({ error }: { error: Error | null }) {
  const t = useTranslations("Wizard");
  const tErrors = useTranslations("ApiErrors");
  if (!error) {
    return null;
  }
  const code = errorCodeOf(error);
  return (
    <p role="alert" className="font-bold">
      {code === "internal" ? t("errors.saveFailed") : tErrors(code)}
    </p>
  );
}
