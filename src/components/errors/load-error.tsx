"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** What a page or card shows when its data can't load: say so and offer to try again. */
export function LoadError({
  message,
  onRetry,
  bare = false,
}: {
  /** What didn't load, when the place says more than "this". */
  message?: string;
  onRetry: () => void;
  /** Inside a card that keeps its own title and controls: no frame of its own. */
  bare?: boolean;
}) {
  const t = useTranslations("Errors");
  const content = (
    <>
      <p>{message ?? t("loadError")}</p>
      <Button tone="primary" onClick={onRetry}>
        {t("retry")}
      </Button>
    </>
  );
  return bare ? (
    <div className="flex flex-col items-start gap-3">{content}</div>
  ) : (
    <Card as="section" className="flex flex-col items-start gap-3">
      {content}
    </Card>
  );
}
