"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Accessible radio group (arrow-key navigation, one tab stop) laid out as a stack of cards. */
export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

/**
 * One option as a pressable Neobrutalist card: outline, hard shadow, a thick-ringed dot that pops
 * in when chosen, primary fill when checked. No motion for reduced-motion users.
 */
export function RadioCard({
  className,
  children,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        "group flex min-h-11 w-full items-center gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 py-2 text-left text-sm font-bold text-ink shadow-brutal-sm transition-[transform,box-shadow,background-color] duration-300 ease-spring active:translate-y-0.5 active:shadow-none data-[state=checked]:bg-fill-primary data-[state=checked]:text-on-fill motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface group-data-[state=checked]:border-on-fill"
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-on-fill data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 motion-reduce:animate-none" />
      </span>
      <span>{children}</span>
    </RadioGroupPrimitive.Item>
  );
}
