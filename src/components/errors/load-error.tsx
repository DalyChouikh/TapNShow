"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** What a page or card shows when its data can't load: say so and offer to try again. */
export function LoadError({
  message,
  onRetry,
}: {
  /** What didn't load, when the place says more than "this". */
  message?: string;
  onRetry: () => void;
}) {
  const t = useTranslations("Errors");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <p>{message ?? t("loadError")}</p>
      <Button tone="primary" onClick={onRetry}>
        {t("retry")}
      </Button>
    </Card>
  );
}
