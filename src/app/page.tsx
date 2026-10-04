"use client";

import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";

/** Temporary landing placeholder until the M9 landing page exists. */
export default function HomePage() {
  const t = useTranslations("Home");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <h1 className="text-4xl font-bold">
        {t("title", { appName: APP_NAME })}
      </h1>
    </main>
  );
}
