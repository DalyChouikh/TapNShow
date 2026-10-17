"use client";

import { Table } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { DEVICE_KEYS, REMINDERS_NOT_NOW_DAYS } from "@/config/members";
import { useHiddenUntil } from "@/lib/device/use-hidden-until";
import { settingsPath } from "@/lib/with-query";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import type { ReadySetup } from "./home-checklist";

/**
 * Home's optional Google Sheets step once setup is done (design §2.6), for the Owner, who connects
 * it. "Not now" hides it on this device as long as the reminders card's "Not now".
 */
export function SheetsTip({
  workspace,
  setup,
  now,
}: {
  workspace: WorkspaceDetails;
  setup: ReadySetup;
  now: Date;
}) {
  const t = useTranslations("WorkspaceHome.sheetsTip");
  const notNow = useHiddenUntil(
    DEVICE_KEYS.sheetsTipHiddenUntil,
    REMINDERS_NOT_NOW_DAYS,
    now,
  );
  if (
    notNow.hidden ||
    workspace.myRole !== "owner" ||
    !setup.complete ||
    setup.done.connectSheets
  ) {
    return null;
  }
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Sticker tone="info">
          <Table weight="bold" />
        </Sticker>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-bold">{t("title")}</h2>
          <p className="text-sm text-muted-ink">{t("body")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Settings, not Google: the privacy text is always read before connecting. */}
        <Button asChild tone="surface">
          <Link href={settingsPath(workspace.slug, "sheets")}>
            {t("connect")}
          </Link>
        </Button>
        <Button tone="surface" onClick={notNow.hide}>
          {t("notNow")}
        </Button>
      </div>
    </Card>
  );
}
