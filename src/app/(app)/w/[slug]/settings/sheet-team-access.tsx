"use client";

import { useTranslations } from "next-intl";
import { Pill } from "@/components/ui/pill";
import type { SheetTeamCounts } from "@/shared/api/sheets";
import { SettingsSectionLink } from "./settings-section";

/**
 * Owner, Settings > Google Sheets, sheet on (#413, design §3 option A): who on the team can view
 * the sheet, as counts only. Who Google couldn't share with is one sentence, never a list; People
 * marks them.
 */
export function SheetTeamAccess({
  team,
  onShowPeople,
}: {
  team: SheetTeamCounts;
  /** Runs when the Owner follows "They're marked in People." */
  onShowPeople?: () => void;
}) {
  const t = useTranslations("Settings.sheets.team");
  if (team.total === 0) {
    return <p className="text-sm">{t("alone")}</p>;
  }
  const tone =
    team.inProgress > 0 ? "info" : team.cantOpen > 0 ? "warning" : "success";
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">
        <Pill tone={tone}>
          {team.inProgress > 0 ? t("sharing") : t("shared")}
        </Pill>{" "}
        {t("summary", { canView: team.canView, total: team.total })}
      </p>
      {team.cantOpen > 0 ? (
        <>
          <p className="text-sm">{t("cantOpen", { count: team.cantOpen })}</p>
          <SettingsSectionLink section="people" onFollow={onShowPeople}>
            {t("markedInPeople")}
          </SettingsSectionLink>
        </>
      ) : null}
      <p className="text-sm text-muted-ink">{t("follows")}</p>
    </div>
  );
}
