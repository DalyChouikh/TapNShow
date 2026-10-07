"use client";

import { Hourglass } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/** Styled empty state for destinations of later milestones (spec §4 Navigation). */
export function ComingSoon({ area }: { area: "meetings" }) {
  const t = useTranslations("ComingSoon");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <Sticker tone="warning">
        <Hourglass weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl">{t(`${area}Title`)}</h1>
      <p className="text-muted-ink">{t(`${area}Body`)}</p>
    </Card>
  );
}
