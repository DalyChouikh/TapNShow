"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IMPORT_FILE_MAX_BYTES } from "@/config/roster";
import {
  ImportFileError,
  readImportFile,
  type ImportFileErrorReason,
} from "@/lib/import/read-import-file";
import type { ImportSheet } from "@/lib/import/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const ACCEPT =
  ".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Step 1: a file read on the device (with a sheet choice) or text pasted from a spreadsheet. */
export function SourceStep({
  source,
  onSourceChange,
  sheets,
  sheetIndex,
  onSheets,
  onSheetIndex,
  pasteText,
  onPasteText,
}: {
  source: "file" | "paste";
  onSourceChange: (source: "file" | "paste") => void;
  sheets: ImportSheet[];
  sheetIndex: number;
  onSheets: (sheets: ImportSheet[]) => void;
  onSheetIndex: (index: number) => void;
  pasteText: string;
  onPasteText: (text: string) => void;
}) {
  const t = useTranslations("ListsImport");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<ImportFileErrorReason | null>(
    null,
  );
  const megabytes = IMPORT_FILE_MAX_BYTES / BYTES_PER_MEGABYTE;
  const current = sheets[sheetIndex];
  const rowCount = current
    ? current.grid.filter((row) => row.some((cell) => cell !== "")).length
    : 0;

  const onFile = async (file: File) => {
    setFileError(null);
    try {
      const read = await readImportFile(file);
      setFileName(file.name);
      onSheetIndex(0);
      onSheets(read);
    } catch (error) {
      setFileName(null);
      onSheets([]);
      setFileError(
        error instanceof ImportFileError ? error.reason : "unreadable",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={t("sourceLabel")}
        value={source}
        onValueChange={(value) =>
          onSourceChange(value === "paste" ? "paste" : "file")
        }
        options={[
          { value: "file", label: t("sourceFile") },
          { value: "paste", label: t("sourcePaste") },
        ]}
      />
      {source === "file" ? (
        <>
          <FileDropZone
            id="import-file"
            title={t("dropTitle")}
            hint={t("dropHint", { megabytes })}
            accept={ACCEPT}
            onFile={(file) => void onFile(file)}
          />
          {fileError ? (
            <p role="alert" className="font-bold">
              {t(`fileErrors.${fileError}`, { megabytes })}
            </p>
          ) : null}
          {fileName && current ? (
            <p className="text-sm break-all">
              {t("fileChosen", { name: fileName, rows: rowCount })}
            </p>
          ) : null}
          {sheets.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <span id="import-sheet-label" className="text-sm font-bold">
                {t("sheetLabel")}
              </span>
              <Select
                value={String(sheetIndex)}
                onValueChange={(value) => onSheetIndex(Number(value))}
              >
                <SelectTrigger aria-labelledby="import-sheet-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((sheet, index) => (
                    <SelectItem key={sheet.name} value={String(index)}>
                      {sheet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </>
      ) : (
        <Textarea
          id="import-paste"
          label={t("pasteLabel")}
          hint={t("pasteHint")}
          value={pasteText}
          onChange={(event) => onPasteText(event.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
