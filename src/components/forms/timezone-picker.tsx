"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
import { listTimezones } from "@/lib/timezones";

/** Searchable IANA timezone combobox (spec §10). */
export function TimezonePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (timezone: string) => void;
  error?: string;
}) {
  const t = useTranslations("TimezonePicker");
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => listTimezones(), []);
  const labelId = `${id}-label`;
  const errorId = error ? `${id}-error` : undefined;
  const listId = `${id}-options`;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-bold text-ink">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-labelledby={labelId}
            aria-describedby={errorId}
            aria-invalid={error ? true : undefined}
            className="flex min-h-11 items-center justify-between rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-left text-base text-ink shadow-brutal-sm"
          >
            {value}
            <CaretDown weight="bold" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          id={listId}
          className="w-[min(22rem,calc(100vw-2rem))] p-1.5"
        >
          <Command>
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  {zone}
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
