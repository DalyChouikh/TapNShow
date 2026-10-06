"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Outlined pill switch; the thumb springs across when on (instant for reduced motion). */
export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-7 w-11 shrink-0 items-center rounded-full border-[length:var(--tn-border-width)] border-outline bg-fill-neutral p-0.5 shadow-brutal-sm transition-colors data-[state=checked]:bg-fill-primary motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface transition-transform duration-300 ease-spring data-[state=checked]:translate-x-4 motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
}
