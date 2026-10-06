"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Outlined pill switch inside a 44 px tap target (spec §12); the thumb springs across when on
 * (instant for reduced motion).
 */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="inline-flex h-7 w-11 items-center rounded-full border-[length:var(--tn-border-width)] border-outline bg-fill-neutral p-0.5 shadow-brutal-sm transition-colors group-data-[state=checked]:bg-fill-primary motion-reduce:transition-none"
      >
        <SwitchPrimitive.Thumb className="block size-5 rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface transition-transform duration-300 ease-spring data-[state=checked]:translate-x-4 motion-reduce:transition-none" />
      </span>
    </SwitchPrimitive.Root>
  );
}
