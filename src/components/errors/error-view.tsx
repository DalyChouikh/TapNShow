"use client";

import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sticker } from "@/components/ui/sticker";

/**
 * What a crashed page shows (spec §7.18): plain words, no technical details. The card's content
 * only: the page around it is the caller's (`error.tsx`; the design showcase).
 */
export function ErrorView({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Errors");
  return (
    <>
      <Sticker tone="warning">
        <WarningCircle weight="bold" />
      </Sticker>
      <h1 className="font-display text-3xl">{t("errorTitle")}</h1>
      <p>{t("errorBody")}</p>
      <div className="flex flex-col gap-3">
        <Button tone="primary" onClick={onRetry}>
          {t("retry")}
        </Button>
        <Button asChild>
          <Link href="/">{t("goHome")}</Link>
        </Button>
      </div>
    </>
  );
}
