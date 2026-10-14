"use client";

import { useTranslations } from "next-intl";
import { DisplayNameForm } from "@/components/forms/display-name-form";
import { ExportMenu } from "@/components/forms/export-menu";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { DeleteAccountCard } from "./delete-account-card";
import { useDownloadMyAnswers } from "./use-download-my-answers";

/** `/account` (spec §7.4): your name, your answers (download), delete my account. */
export function AccountView() {
  const t = useTranslations("Account");
  const me = useMe();
  const email = me.data?.profile.email ?? "";
  const download = useDownloadMyAnswers(email);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <Card as="section" className="flex flex-col gap-3">
        <h2 className="font-bold">{t("name")}</h2>
        {me.data ? (
          <>
            <DisplayNameForm initialName={me.data.profile.displayName ?? ""} />
            <p className="text-sm break-words text-muted-ink">
              {t("signedInAs", { email })}
            </p>
          </>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Card>
      <Card as="section" className="flex flex-col gap-3">
        <h2 className="font-bold">{t("answersTitle")}</h2>
        <p>{t("answersBody")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <ExportMenu label={t("download")} onExport={download} />
          <span className="text-sm text-muted-ink">{t("downloadHint")}</span>
        </div>
      </Card>
      <DeleteAccountCard />
    </section>
  );
}
