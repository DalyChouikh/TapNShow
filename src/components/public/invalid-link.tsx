"use client";

import { LinkBreak } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";

/** A malformed, unknown or rate-limited personal link (all look the same to the visitor). */
export function InvalidLink({ limited = false }: { limited?: boolean }) {
  const t = useTranslations("TokenPages");
  return (
    <>
      <Sticker tone="neutral">
        <LinkBreak weight="bold" />
      </Sticker>
      <h1 className="font-display text-2xl">{t("invalidTitle")}</h1>
      <p>{limited ? t("limited") : t("invalidBody")}</p>
    </>
  );
}
