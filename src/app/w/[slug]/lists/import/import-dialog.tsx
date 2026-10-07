"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportContacts } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { buildImportRows } from "@/lib/import/build-import-rows";
import { guessColumns, mappingProblem } from "@/lib/import/guess-columns";
import { parsePaste } from "@/lib/import/parse-delimited";
import type { ColumnMapping, ImportSheet } from "@/lib/import/types";
import type { ImportResult, Roster } from "@/shared/api/roster";
import { MatchStep } from "./match-step";
import { PreviewStep } from "./preview-step";
import { SourceStep } from "./source-step";
import { WizardFooter } from "./wizard-footer";

type Step = 1 | 2 | 3;
const EMPTY_MAPPING: ColumnMapping = { hasHeader: true, targets: [] };

/**
 * Import wizard (spec §7.14): full screen on phones. Nothing is saved before the last button;
 * Preview asks the server for a dry run of exactly the rows the commit will send.
 */
export function ImportDialog({
  slug,
  roster,
  initialSource,
  open,
  onOpenChange,
}: {
  slug: string;
  roster: Roster;
  initialSource: "file" | "paste";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("ListsImport");
  const tErrors = useTranslations("ApiErrors");
  const importContacts = useImportContacts(slug);
  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState(initialSource);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [alsoAddToListId, setAlsoAddToListId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const grid =
    source === "paste"
      ? parsePaste(pasteText)
      : (sheets[sheetIndex]?.grid ?? []);
  const hasContent = grid.some((row) => row.some((cell) => cell !== ""));
  const rows = step >= 2 ? buildImportRows(grid, mapping) : [];
  const onError = (error: Error) =>
    toast.error(
      tErrors(error instanceof ApiClientError ? error.code : "internal"),
    );
  const body = (dryRun: boolean) => ({
    rows,
    dryRun,
    ...(alsoAddToListId ? { alsoAddToListId } : {}),
  });
  const importCount = preview
    ? preview.summary.new + preview.summary.updated
    : 0;

  const footer = {
    1: {
      primaryLabel: t("next"),
      primaryDisabled: !hasContent,
      onPrimary: () => {
        setMapping(guessColumns(grid));
        setStep(2);
      },
    },
    2: {
      primaryLabel: t("previewAction"),
      primaryDisabled:
        importContacts.isPending ||
        mappingProblem(mapping) !== null ||
        rows.length === 0 ||
        rows.length > roster.limits.importRowsMax,
      onPrimary: () =>
        importContacts.mutate(body(true), {
          onSuccess: (result) => {
            setPreview(result);
            setStep(3);
          },
          onError,
        }),
    },
    3: {
      primaryLabel: t("importAction", { count: importCount }),
      primaryDisabled:
        importContacts.isPending ||
        importCount === 0 ||
        preview?.limitExceeded !== null,
      onPrimary: () =>
        importContacts.mutate(body(false), {
          onSuccess: (result) => {
            toast(
              t("done", {
                added: result.summary.new,
                updated: result.summary.updated,
                lists: result.newLists.length,
              }),
            );
            onOpenChange(false);
          },
          onError,
        }),
    },
  }[step];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 max-h-dvh rounded-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-card">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("stepOf", { step })}</DialogDescription>
        </DialogHeader>
        {step === 1 ? (
          <SourceStep
            source={source}
            onSourceChange={setSource}
            sheets={sheets}
            sheetIndex={sheetIndex}
            onSheets={setSheets}
            onSheetIndex={setSheetIndex}
            pasteText={pasteText}
            onPasteText={setPasteText}
          />
        ) : null}
        {step === 2 ? (
          <MatchStep
            grid={grid}
            mapping={mapping}
            onMappingChange={setMapping}
            rowCount={rows.length}
            rowLimit={roster.limits.importRowsMax}
            lists={roster.lists}
            alsoAddToListId={alsoAddToListId}
            onAlsoAddChange={setAlsoAddToListId}
          />
        ) : null}
        {step === 3 && preview ? (
          <PreviewStep result={preview} limits={roster.limits} />
        ) : null}
        <WizardFooter
          backLabel={step > 1 ? t("back") : undefined}
          onBack={step > 1 ? () => setStep(step === 3 ? 2 : 1) : undefined}
          {...footer}
        />
      </DialogContent>
    </Dialog>
  );
}
