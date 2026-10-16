"use client";

import { PauseCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Sticker } from "@/components/ui/sticker";

/** Owners and Admins of a suspended workspace (spec §7.12): plain words and how to reach us. */
export function SuspendedBanner({ contact }: { contact: string }) {
  const t = useTranslations("Shell");
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-fill-warning p-3 text-on-fill shadow-brutal-sm"
    >
      <Sticker tone="surface">
        <PauseCircle weight="bold" />
      </Sticker>
      <p className="text-sm">
        <span className="font-bold">{t("suspendedTitle")}</span>{" "}
        {t("suspendedBody")}{" "}
        <a className="font-bold underline underline-offset-4" href={contact}>
          {t("suspendedContact")}
        </a>
      </p>
    </div>
  );
}
