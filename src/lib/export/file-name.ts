import { format } from "date-fns";
import { slugBase, SLUG_FALLBACK_BASE } from "@/lib/slug";

/** Longest name part before the date. */
const NAME_MAX = 80;

/** `gdg-issat-weekly-sync-answers-2026-10-08.csv`: slugged parts, empty ones dropped, then the date. */
export function exportFileName(
  parts: string[],
  extension: "csv" | "xlsx",
  today: Date,
): string {
  const name = parts
    .map((part) => (part.trim() === "" ? "" : slugBase(part)))
    .filter((part) => part !== "" && part !== SLUG_FALLBACK_BASE)
    .join("-")
    .slice(0, NAME_MAX)
    .replace(/-+$/g, "");
  return `${name || "export"}-${format(today, "yyyy-MM-dd")}.${extension}`;
}
