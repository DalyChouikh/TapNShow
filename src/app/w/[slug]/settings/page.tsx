"use client";

import { useTranslations } from "next-intl";

/** `/w/[slug]/settings` — sections arrive in Task 11. */
export default function SettingsPage() {
  const t = useTranslations("Settings");
  return <h1 className="font-display text-3xl">{t("title")}</h1>;
}
