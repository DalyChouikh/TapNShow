"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** What an admin page shows when its data can't load: say so and offer to try again. */
export function AdminLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Admin");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <p>{t("loadError")}</p>
      <Button tone="primary" onClick={onRetry}>
        {t("retry")}
      </Button>
    </Card>
  );
}
