"use client";

import { useTranslations } from "next-intl";
import type { SheetSharing } from "@/shared/api/sheets";

/**
 * A team member, Settings > Google Sheets, sheet on (#413, design §3): one line about their own
 * address. Nothing for the Owner (they see the team's counts instead).
 */
export function SheetMyAccess({
  sharing,
  ownerName,
}: {
  sharing: SheetSharing;
  ownerName: string;
}) {
  const t = useTranslations("Settings.sheets.team");
  const email = sharing.myEmail ?? "";
  const line =
    sharing.mine === "shared"
      ? t("mineShared", { email })
      : sharing.mine === "sharing"
        ? t("mineSharing")
        : sharing.mine === "refused"
          ? t("mineRefused", { email, owner: ownerName })
          : sharing.mine === "sheet_account"
            ? t("mineAccount")
            : null;
  return line ? (
    <p className="text-sm break-words text-muted-ink">{line}</p>
  ) : null;
}
