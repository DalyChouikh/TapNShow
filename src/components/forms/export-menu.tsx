"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A file format an export can produce. */
export type ExportFormat = "csv" | "xlsx";

/**
 * The workspace's Google Sheet in the menu (spec §7.17): its link, or "paused" (a link to Settings
 * for the Owner, a disabled item for everyone else).
 */
export type ExportSheetLink = {
  href: string | null;
  paused: boolean;
  settingsHref?: string;
};

/**
 * "Export" → CSV / Excel (spec §7.7); busy while the file is built, a toast if it fails. With a
 * `sheet`, it also offers "Open the Google Sheet".
 */
export function ExportMenu({
  onExport,
  sheet,
  label,
}: {
  onExport: (format: ExportFormat) => Promise<void>;
  sheet?: ExportSheetLink;
  /** The trigger's words (default "Export"). */
  label?: string;
}) {
  const t = useTranslations("Export");
  const [busy, setBusy] = useState(false);
  const run = (format: ExportFormat) => {
    setBusy(true);
    onExport(format)
      .catch((error: Error) => {
        Sentry.captureException(error);
        toast.error(t("failed"));
      })
      .finally(() => setBusy(false));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button disabled={busy} aria-busy={busy}>
          <DownloadSimple weight="bold" aria-hidden />
          {busy ? t("preparing") : (label ?? t("button"))}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run("csv")}>
          {t("csv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("xlsx")}>
          {t("xlsx")}
        </DropdownMenuItem>
        {sheet ? (
          <>
            <DropdownMenuSeparator />
            {!sheet.paused && sheet.href ? (
              <DropdownMenuItem asChild>
                <a href={sheet.href} target="_blank" rel="noopener noreferrer">
                  {t("openSheet")}
                </a>
              </DropdownMenuItem>
            ) : sheet.settingsHref ? (
              <DropdownMenuItem asChild>
                <Link href={sheet.settingsHref}>{t("sheetPaused")}</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>{t("sheetPaused")}</DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
