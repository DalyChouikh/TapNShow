"use client";

import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { format, parse } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const WALL = "yyyy-MM-dd";
const toDate = (value: string) => parse(value, WALL, new Date(0));

/** Date of a meeting as a wall date in its zone (spec §7.2 Details). No browser-native picker. */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  today,
  min,
  max,
  error,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (date: string) => void;
  today: string;
  min?: string;
  /** The last day offered (inclusive). */
  max?: string;
  error?: string;
}) {
  const t = useTranslations("Pickers");
  const [open, setOpen] = useState(false);
  const selected = value ? toDate(value) : undefined;
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
            // A button cannot be aria-invalid; the error is announced via aria-describedby.
            data-invalid={error ? "" : undefined}
            aria-describedby={errorId}
            className={cn(
              buttonVariants({ tone: "surface" }),
              "group w-full justify-start whitespace-nowrap shadow-brutal-sm data-invalid:bg-fill-danger data-invalid:text-on-fill",
            )}
          >
            <CalendarBlank weight="bold" aria-hidden />
            {selected ? (
              format(
                selected,
                selected.getFullYear() === toDate(today).getFullYear()
                  ? "EEE d MMM"
                  : "EEE d MMM yyyy",
              )
            ) : (
              <span className="text-muted-ink group-data-invalid:text-on-fill-muted">
                {t("pickDate")}
              </span>
            )}
          </button>
        </PopoverTrigger>
        {/* Seven 44 px days need 317 px: on 320 px phones the panel runs almost edge to edge. */}
        <PopoverContent
          className="w-auto p-0.5 min-[360px]:p-1.5"
          collisionPadding={1}
        >
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected ?? toDate(today)}
            today={toDate(today)}
            disabled={[
              ...(min ? [{ before: toDate(min) }] : []),
              ...(max ? [{ after: toDate(max) }] : []),
            ]}
            onSelect={(day) => {
              if (day) {
                onChange(format(day, WALL));
                setOpen(false);
              }
            }}
            labels={{
              labelPrevious: () => t("previousMonth"),
              labelNext: () => t("nextMonth"),
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === "left" ? (
                  <CaretLeft weight="bold" aria-hidden />
                ) : (
                  <CaretRight weight="bold" aria-hidden />
                ),
            }}
            classNames={{
              root: "text-ink",
              months: "relative",
              month_caption:
                "flex h-11 items-center justify-center font-display",
              nav: "absolute inset-x-0 top-0 flex justify-between",
              button_previous:
                "inline-flex size-11 items-center justify-center rounded-control",
              button_next:
                "inline-flex size-11 items-center justify-center rounded-control",
              month_grid: "border-collapse",
              weekday: "size-11 text-xs font-bold text-muted-ink",
              day: "p-0 text-center",
              day_button:
                "size-11 rounded-control text-sm font-bold transition-transform active:translate-y-0.5 motion-reduce:transition-none",
              selected:
                "[&>button]:border-[length:var(--tn-border-width)] [&>button]:border-outline [&>button]:bg-fill-primary [&>button]:text-on-fill [&>button]:shadow-brutal-sm",
              today:
                "[&>button]:outline-2 [&>button]:outline-dashed [&>button]:outline-outline",
              disabled: "[&>button]:text-muted-ink [&>button]:opacity-50",
              outside: "[&>button]:text-muted-ink",
            }}
          />
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
