"use client";

import { Clock } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { TIME_STEP_MINUTES } from "@/config/meetings";
import { parseTypedTime, timeOptions } from "@/lib/meetings/time-input";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Meeting time (spec §7.2 Details): a 15-minute list you can type into ("1830" jumps). */
export function TimePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (time: string) => void;
  error?: string;
}) {
  const t = useTranslations("Pickers");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = useMemo(() => timeOptions(TIME_STEP_MINUTES), []);
  const typed = parseTypedTime(search);
  const visible = typed
    ? options.filter((option) => option.startsWith(typed.slice(0, 2)))
    : options;
  const offerTyped = typed !== null && !options.includes(typed);
  const choose = (time: string) => {
    onChange(time);
    setSearch("");
    setOpen(false);
  };
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-bold text-ink">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-labelledby={`${id}-label ${id}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              buttonVariants({ tone: "surface" }),
              "w-full justify-start whitespace-nowrap shadow-brutal-sm aria-invalid:bg-fill-danger",
            )}
          >
            <Clock weight="bold" aria-hidden />
            {value ?? <span className="text-muted-ink">{t("pickTime")}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1.5">
          <Command shouldFilter={false} value={typed ?? value ?? undefined}>
            <CommandInput
              placeholder={t("timeSearch")}
              value={search}
              onValueChange={setSearch}
              inputMode="numeric"
            />
            <CommandList className="max-h-64">
              {search && typed === null ? (
                <CommandEmpty>{t("noTime")}</CommandEmpty>
              ) : null}
              {offerTyped && typed ? (
                <CommandItem
                  value={`use-${typed}`}
                  onSelect={() => choose(typed)}
                >
                  {t("useTime", { time: typed })}
                </CommandItem>
              ) : null}
              {visible.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => choose(option)}
                >
                  {option}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={errorId} className="text-sm font-bold text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
