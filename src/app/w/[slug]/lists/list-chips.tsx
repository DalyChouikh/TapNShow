"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Chip } from "@/components/ui/chip";
import { NO_LIST, type ListFilter } from "@/lib/roster/filter-contacts";
import type { ListSummary } from "@/shared/api/roster";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";

/** "All N", "No list N" (only when someone has no list), then one chip per list. Scrolls sideways. */
export function ListChips({
  lists,
  total,
  noListCount,
  selectedListId,
  onSelect,
  trailing,
}: {
  lists: ListSummary[];
  total: number;
  noListCount: number;
  selectedListId: ListFilter;
  onSelect: (listId: ListFilter) => void;
  trailing?: ReactNode;
}) {
  const t = useTranslations("Lists");
  return (
    <div
      role="group"
      aria-label={t("listChipsLabel")}
      className={CHIP_ROW_CLASS}
    >
      <Chip
        pressed={selectedListId === null}
        onPressedChange={() => onSelect(null)}
        className="shrink-0"
      >
        {t("allChip", { count: total })}
      </Chip>
      {noListCount > 0 ? (
        <Chip
          pressed={selectedListId === NO_LIST}
          onPressedChange={(pressed) => onSelect(pressed ? NO_LIST : null)}
          className="shrink-0"
        >
          {t("noListChip", { count: noListCount })}
        </Chip>
      ) : null}
      {lists.map((list) => (
        <Chip
          key={list.id}
          pressed={selectedListId === list.id}
          onPressedChange={(pressed) => onSelect(pressed ? list.id : null)}
          className="shrink-0"
        >
          {list.name} {list.contactCount}
        </Chip>
      ))}
      {trailing}
    </div>
  );
}
