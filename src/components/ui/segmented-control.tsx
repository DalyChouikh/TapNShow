"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * One choice among a few, as joined outlined segments (Radix ToggleGroup, arrow-key navigation).
 * Clicking the active segment keeps it selected, so there is always a value.
 */
export function SegmentedControl({
  label,
  value,
  onValueChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onValueChange(next);
        }
      }}
      className={cn(
        "grid auto-cols-fr grid-flow-col overflow-hidden rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface shadow-brutal-sm",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="min-h-11 px-3 text-sm font-bold text-ink transition-colors not-last:border-r-[length:var(--tn-border-width)] not-last:border-outline data-[state=on]:bg-ink data-[state=on]:text-surface motion-reduce:transition-none"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
