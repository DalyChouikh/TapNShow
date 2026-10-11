import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import {
  type AppMessages,
  type ExportWords,
  exportWords,
} from "@/lib/export/words";

function sheetTranslator(locale: Locale, catalogue: AppMessages) {
  return createTranslator({ locale, messages: catalogue, namespace: "Sheet" });
}

/** The `Sheet` namespace translator. */
export type SheetTranslator = ReturnType<typeof sheetTranslator>;

/** Export words plus the Google Sheet's own (band, subtitle, meeting cell, tab names). */
export type SheetWords = ExportWords & { sheet: SheetTranslator };

/** Every word a Google Sheet tab needs, for one locale. */
export function sheetWords(locale: Locale, catalogue: AppMessages): SheetWords {
  return {
    ...exportWords(locale, catalogue),
    sheet: sheetTranslator(locale, catalogue),
  };
}
