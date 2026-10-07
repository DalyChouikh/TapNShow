"use client";

import { useTranslations } from "next-intl";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { mappingProblem } from "@/lib/import/guess-columns";
import type {
  ColumnMapping,
  ColumnTarget,
  SheetGrid,
} from "@/lib/import/types";
import type { ListSummary } from "@/shared/api/roster";
import { ListTag } from "../list-tag";

const TARGETS: readonly ColumnTarget[] = [
  "fullName",
  "email",
  "lists",
  "ignore",
];
const isColumnTarget = (value: string): value is ColumnTarget =>
  TARGETS.some((target) => target === value);

/** Step 2: what each column means, whether row 1 is a header, and an optional list for everyone. */
export function MatchStep({
  grid,
  mapping,
  onMappingChange,
  rowCount,
  rowLimit,
  lists,
  alsoAddToListId,
  onAlsoAddChange,
  onCreateList,
}: {
  grid: SheetGrid;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  rowCount: number;
  rowLimit: number;
  lists: ListSummary[];
  alsoAddToListId: string | null;
  onAlsoAddChange: (listId: string | null) => void;
  /** Creates a list (the API then knows its id, so it can be the "also add" target). */
  onCreateList: (name: string) => Promise<{ id: string }>;
}) {
  const t = useTranslations("ListsImport");
  const headerIndex = grid.findIndex((row) => row.some((cell) => cell !== ""));
  const header = grid[headerIndex] ?? [];
  const firstData = grid
    .slice(mapping.hasHeader ? headerIndex + 1 : headerIndex)
    .filter((row) => row.some((c) => c !== ""));
  const problem = mappingProblem(mapping);
  const alsoAdd = lists.find((list) => list.id === alsoAddToListId);
  const columnName = (column: number) =>
    mapping.hasHeader && header[column]
      ? header[column]
      : t("columnN", { n: column + 1 });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-ink">
        {t("matchIntro", { rows: rowCount })}
      </p>
      <label className="flex min-h-11 items-center gap-3 font-bold">
        <Switch
          checked={mapping.hasHeader}
          onCheckedChange={(hasHeader) =>
            onMappingChange({ ...mapping, hasHeader })
          }
        />
        {t("headerSwitch")}
      </label>
      <ul className="flex flex-col divide-y-2 divide-dashed divide-fill-neutral rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface px-3 shadow-brutal-sm">
        {mapping.targets.map((target, column) => {
          const sample = firstData
            .map((row) => row[column] ?? "")
            .find((cell) => cell !== "");
          const labelId = `match-column-${column}`;
          return (
            <li
              key={column}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <p id={labelId} className="truncate font-bold">
                  {columnName(column)}
                </p>
                <p className="truncate text-xs text-muted-ink">
                  {sample ?? t("sampleEmpty")}
                </p>
              </div>
              <Select
                value={target}
                onValueChange={(value) => {
                  if (isColumnTarget(value)) {
                    onMappingChange({
                      ...mapping,
                      targets: mapping.targets.map((old, i) =>
                        i === column ? value : old,
                      ),
                    });
                  }
                }}
              >
                <SelectTrigger
                  aria-label={t("columnTarget", { column: columnName(column) })}
                  className="w-36 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGETS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`targets.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{t("alsoAdd")}</span>
        {alsoAdd ? <ListTag list={alsoAdd} /> : null}
        <ListPicker
          mode="single"
          lists={lists}
          selectedIds={alsoAddToListId ? [alsoAddToListId] : []}
          onChange={([listId]) => onAlsoAddChange(listId ?? null)}
          onCreate={onCreateList}
          triggerLabel={t("alsoAddPick")}
        />
        {alsoAdd ? (
          <Button onClick={() => onAlsoAddChange(null)}>
            {t("alsoAddClear")}
          </Button>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="font-bold">
          {t(`problems.${problem}`)}
        </p>
      ) : null}
      {rowCount > rowLimit ? (
        <p role="alert" className="font-bold">
          {t("problems.too_many_rows", { rows: rowCount, max: rowLimit })}
        </p>
      ) : null}
      {rowCount === 0 ? (
        <p role="alert" className="font-bold">
          {t("problems.no_rows")}
        </p>
      ) : null}
    </div>
  );
}
