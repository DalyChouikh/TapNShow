"use client";

import { Check } from "@phosphor-icons/react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Neobrutalist checkbox: the control is a 44 px tap target (spec §12) that draws a 24 px outlined
 * box with the small hard shadow; checked = primary fill and a bold check that pops in (none for
 * reduced motion).
 */
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group inline-flex size-11 shrink-0 items-center justify-center rounded-control",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="inline-flex size-6 items-center justify-center rounded-[8px] border-[length:var(--tn-border-width)] border-outline bg-surface text-on-fill shadow-brutal-sm transition-[transform,box-shadow,background-color] duration-300 ease-spring group-active:translate-y-0.5 group-active:shadow-none group-data-[state=checked]:bg-fill-primary motion-reduce:transition-none"
      >
        <CheckboxPrimitive.Indicator className="data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 motion-reduce:animate-none">
          <Check weight="bold" className="size-4" aria-hidden />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
