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
  compact = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
  /** Smaller one-line labels for four options on 320 px phones. */
  compact?: boolean;
  /** Shown but not changeable (e.g. the answer type of a sent meeting). */
  disabled?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      disabled={disabled}
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
          className={cn(
            "min-h-11 font-bold text-ink transition-colors not-last:border-r-[length:var(--tn-border-width)] not-last:border-outline disabled:cursor-not-allowed disabled:opacity-60 data-[state=on]:bg-ink data-[state=on]:text-surface motion-reduce:transition-none",
            compact
              ? "px-2 text-xs whitespace-nowrap min-[360px]:text-sm"
              : "px-3 text-sm",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
