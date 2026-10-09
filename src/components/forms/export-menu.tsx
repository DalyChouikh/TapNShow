"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A file format an export can produce. */
export type ExportFormat = "csv" | "xlsx";

/** "Export" → CSV / Excel (spec §7.7); busy while the file is built, a toast if it fails. */
export function ExportMenu({
  onExport,
}: {
  onExport: (format: ExportFormat) => Promise<void>;
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
          {busy ? t("preparing") : t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run("csv")}>
          {t("csv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("xlsx")}>
          {t("xlsx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
