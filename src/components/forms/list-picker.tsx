"use client";

import { Check, Plus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listNameSchema, type ListSummary } from "@/shared/api/roster";

/**
 * Searchable list chooser (cmdk in a popover). "multiple" toggles memberships and stays open;
 * "single" picks one list and closes. With `onCreate`, a name that matches no list (ignoring
 * case) can be created and is selected right away.
 */
export function ListPicker({
  lists,
  selectedIds,
  onChange,
  onCreate,
  mode = "multiple",
  triggerLabel,
  triggerClassName,
  disabled = false,
}: {
  lists: ListSummary[];
  selectedIds: string[];
  onChange: (listIds: string[]) => void;
  onCreate?: (name: string) => Promise<{ id: string }>;
  mode?: "multiple" | "single";
  triggerLabel: string;
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Lists");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const typed = listNameSchema.safeParse(search);
  const canCreate =
    onCreate !== undefined &&
    typed.success &&
    !lists.some((list) => list.name.toLowerCase() === typed.data.toLowerCase());

  const choose = (listId: string) => {
    if (mode === "single") {
      onChange([listId]);
      setOpen(false);
      return;
    }
    onChange(
      selectedIds.includes(listId)
        ? selectedIds.filter((id) => id !== listId)
        : [...selectedIds, listId],
    );
  };

  const create = async () => {
    if (!onCreate || !typed.success) {
      return;
    }
    const created = await onCreate(typed.data);
    setSearch("");
    choose(created.id);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-dashed border-outline px-3 text-sm font-bold text-ink disabled:opacity-50",
            triggerClassName,
          )}
        >
          <Plus weight="bold" aria-hidden />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput
            placeholder={t("searchLists")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("noLists")}</CommandEmpty>
            {lists.map((list) => (
              <CommandItem
                key={list.id}
                value={list.name}
                onSelect={() => choose(list.id)}
                className="justify-between"
              >
                <span className="truncate">{list.name}</span>
                {selectedIds.includes(list.id) ? (
                  <Check weight="bold" aria-hidden />
                ) : null}
              </CommandItem>
            ))}
            {canCreate ? (
              <CommandItem
                forceMount
                value={`create:${typed.data}`}
                onSelect={() => void create()}
              >
                {t("createList", { name: typed.data })}
              </CommandItem>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
