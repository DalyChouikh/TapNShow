"use client";

import { useTranslations } from "next-intl";
import { Pill } from "@/components/ui/pill";
import type { SheetSharing } from "@/shared/api/sheets";
import { SettingsSectionLink } from "./settings-section";

/**
 * Owner, Settings > Google Sheets, sheet on (#413, design §3 option A): who on the team can view
 * the sheet, as counts only. Who Google couldn't share with is one sentence, never a list; People
 * marks them.
 */
export function SheetTeamAccess({ sharing }: { sharing: SheetSharing }) {
  const t = useTranslations("Settings.sheets.team");
  if (sharing.total === 0) {
    return <p className="text-sm">{t("alone")}</p>;
  }
  const tone =
    sharing.inProgress > 0
      ? "info"
      : sharing.cantOpen > 0
        ? "warning"
        : "success";
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">
        <Pill tone={tone}>
          {sharing.inProgress > 0 ? t("sharing") : t("shared")}
        </Pill>{" "}
        {t("summary", { canView: sharing.canView, total: sharing.total })}
      </p>
      {sharing.cantOpen > 0 ? (
        <>
          <p className="text-sm">
            {t("cantOpen", { count: sharing.cantOpen })}
          </p>
          <SettingsSectionLink section="people">
            {t("markedInPeople")}
          </SettingsSectionLink>
        </>
      ) : null}
      <p className="text-sm text-muted-ink">{t("follows")}</p>
    </div>
  );
}
